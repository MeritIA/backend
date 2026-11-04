import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import {
  api,
  consultar,
  crearConRol,
  crearEjercicioEnElBanco,
  levantarAplicacion,
  registrarCandidato,
  uuid,
  type Sesion,
} from './ayudas.js';

/**
 * Moderacion de evaluaciones (Flujo C y pantallas B19 a B21), contra PostgreSQL.
 */
describe('integracion: moderacion', () => {
  let app: INestApplication<Server>;
  let reclutador: Sesion;
  let moderador: Sesion;
  let otroModerador: Sesion;
  let admin: Sesion;
  let ana: Sesion;
  let idVacante: string;
  let idEmpresa: string;
  let idEjercicio: string;
  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });
  const MOTIVO = 'El codigo copia literalmente un repositorio publico, sin cambios propios.';

  beforeAll(async () => {
    await prepararEntorno();
    await migrar();
    app = await levantarAplicacion();
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await vaciarTablas();
    reclutador = await crearConRol(app, 'laura@empresa.com', 'reclutador', 'Empresa A');
    moderador = await crearConRol(app, 'mod1@meritia.co', 'moderador', null);
    otroModerador = await crearConRol(app, 'mod2@meritia.co', 'moderador', null);
    admin = await crearConRol(app, 'admin@meritia.co', 'administrador', null);
    ana = await registrarCandidato(app, 'ana@ejemplo.com', 'Ana Maria Rojas');

    const { body } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(reclutador))
      .send({ titulo: 'Backend', descripcion: 'Buscamos una persona para plataforma.' })
      .expect(201);
    idVacante = body.id as string;
    idEjercicio = await crearEjercicioEnElBanco(app, reclutador, 'Ejercicio');
    await api(app)
      .put(`/api/v1/vacantes/${idVacante}/ejercicios`)
      .set(auth(reclutador))
      .send({ idsDeEjercicios: [idEjercicio] })
      .expect(200);
    await api(app).post(`/api/v1/vacantes/${idVacante}/publicar`).set(auth(reclutador)).expect(200);
    const [fila] = await consultar<{ id_empresa: string }>(
      'select id_empresa from vacantes.vacantes where id = $1',
      [idVacante],
    );
    idEmpresa = fila.id_empresa;
  }, 60_000);

  async function evaluacion(riesgo: 'ninguno' | 'alto', nota = 80): Promise<string> {
    const [e] = await consultar<{ id: string }>(
      `insert into evaluacion.evaluaciones
         (id_entrega, id_vacante, id_candidato, id_empresa, id_ejercicio, id_version,
          nota_final, proveedor, modelo, archivos, riesgo_inyeccion, puntaje_inyeccion, creada_en)
       values ($1, $2, $3, $4, $5, $6, $7, 'gemini', 'gemini-3.5-flash', 1, $8, 9, now())
       returning id`,
      [uuid(), idVacante, ana.id, idEmpresa, idEjercicio, uuid(), nota, riesgo],
    );
    await consultar(
      `insert into evaluacion.calificaciones_criterio
         (id_evaluacion, orden, criterio, puntaje, escala_maxima, peso, evidencia)
       values ($1, 0, 'Correccion', 4, 5, 100, 'En main.py resuelve el caso limite.')`,
      [e.id],
    );
    return e.id;
  }

  async function abrirCaso(idEvaluacion: string): Promise<string> {
    const { ModeracionService } = await import('../../src/modules/moderacion/index.js');
    const caso = await app
      .get(ModeracionService)
      .abrir(idEvaluacion, idVacante, ana.id, 'antifraude');
    return caso!.id;
  }

  const ranking = () =>
    api(app).get(`/api/v1/reportes/vacantes/${idVacante}`).set(auth(reclutador)).expect(200);

  describe('de donde nacen los casos', () => {
    it('una evaluacion con riesgo alto abre un caso antifraude; una limpia no (con muestreo en cero)', async () => {
      const { ModeracionService } = await import('../../src/modules/moderacion/index.js');
      const servicio = app.get(ModeracionService);
      const sospechosa = await evaluacion('alto');
      const limpia = await evaluacion('ninguno');
      expect((await servicio.abrirSiCorresponde(sospechosa))?.origen).toBe('antifraude');
      expect(await servicio.abrirSiCorresponde(limpia)).toBeNull();
      // Idempotente: abrir de nuevo no duplica.
      expect(await servicio.abrirSiCorresponde(sospechosa)).toBeNull();
      const { body } = await api(app)
        .get('/api/v1/moderacion/casos')
        .set(auth(moderador))
        .expect(200);
      expect(body).toHaveLength(1);
    });
  });

  describe('lo que ve el moderador', () => {
    it('alias y evidencia, nunca nombre ni correo, y vence a las 24 h', async () => {
      const id = await abrirCaso(await evaluacion('alto'));
      const { body: lista } = await api(app)
        .get('/api/v1/moderacion/casos')
        .set(auth(moderador))
        .expect(200);
      expect(lista[0].alias).toMatch(/^Candidato ••••/);
      const horas =
        (new Date(lista[0].venceEn).getTime() - new Date(lista[0].creadoEn).getTime()) / 3_600_000;
      expect(Math.round(horas)).toBe(24);

      const { body } = await api(app)
        .get(`/api/v1/moderacion/casos/${id}`)
        .set(auth(moderador))
        .expect(200);
      expect(body.evidencia).toMatchObject({
        riesgo: 'alto',
        criterios: [{ criterio: 'Correccion' }],
      });
      expect(JSON.stringify({ lista, body })).not.toMatch(/Ana Maria|ana@ejemplo/);
    });

    it('un candidato o un reclutador no entran a la bandeja', async () => {
      await api(app).get('/api/v1/moderacion/casos').set(auth(ana)).expect(403);
      await api(app).get('/api/v1/moderacion/casos').set(auth(reclutador)).expect(403);
    });
  });

  describe('decidir', () => {
    it('confirmar descalifica: sale del ranking, y el candidato lee la justificacion', async () => {
      await evaluacion('ninguno', 60);
      const idEval = await evaluacion('alto', 95);
      const id = await abrirCaso(idEval);
      expect((await ranking()).body.ranking).toHaveLength(1); // un solo candidato, con su mejor nota

      await api(app)
        .post(`/api/v1/moderacion/casos/${id}/decidir`)
        .set(auth(moderador))
        .send({ decision: 'confirmar', justificacion: MOTIVO })
        .expect(200);

      const filas = (await ranking()).body.ranking as { notaFinal: number }[];
      expect(filas[0].notaFinal).toBe(60); // la de 95 ya no cuenta

      const { body } = await api(app)
        .get('/api/v1/moderacion/mis-casos')
        .set(auth(ana))
        .expect(200);
      expect(body[0]).toMatchObject({
        estado: 'confirmado',
        justificacion: MOTIVO,
        puedeDisputar: true,
      });
    });

    it('la justificacion es obligatoria y una decision no se reescribe', async () => {
      const id = await abrirCaso(await evaluacion('alto'));
      await api(app)
        .post(`/api/v1/moderacion/casos/${id}/decidir`)
        .set(auth(moderador))
        .send({ decision: 'confirmar', justificacion: 'corta' })
        .expect(400);
      await api(app)
        .post(`/api/v1/moderacion/casos/${id}/decidir`)
        .set(auth(moderador))
        .send({ decision: 'restaurar', justificacion: MOTIVO })
        .expect(200);
      await api(app)
        .post(`/api/v1/moderacion/casos/${id}/decidir`)
        .set(auth(moderador))
        .send({ decision: 'confirmar', justificacion: MOTIVO })
        .expect(400);
    });

    it('mientras esta abierto el candidato no ve ninguna justificacion', async () => {
      await abrirCaso(await evaluacion('alto'));
      const { body } = await api(app)
        .get('/api/v1/moderacion/mis-casos')
        .set(auth(ana))
        .expect(200);
      expect(body[0]).toMatchObject({
        estado: 'abierto',
        justificacion: null,
        puedeDisputar: false,
      });
    });
  });

  describe('disputa', () => {
    it('se disputa una sola vez, la decide OTRO moderador y puede restaurar', async () => {
      const idEval = await evaluacion('alto', 95);
      const id = await abrirCaso(idEval);
      await api(app)
        .post(`/api/v1/moderacion/casos/${id}/decidir`)
        .set(auth(moderador))
        .send({ decision: 'confirmar', justificacion: MOTIVO })
        .expect(200);

      const { body: disputa } = await api(app)
        .post(`/api/v1/moderacion/casos/${id}/disputar`)
        .set(auth(ana))
        .send({ explicacion: 'Escribi el codigo yo misma; el repositorio es mio y esta publico.' })
        .expect(201);
      await api(app)
        .post(`/api/v1/moderacion/casos/${id}/disputar`)
        .set(auth(ana))
        .send({ explicacion: 'Lo vuelvo a intentar, por si acaso paso algo mas.' })
        .expect(409);

      // El mismo moderador no puede decidir su propia disputa.
      await api(app)
        .post(`/api/v1/moderacion/casos/${disputa.id}/decidir`)
        .set(auth(moderador))
        .send({ decision: 'restaurar', justificacion: MOTIVO })
        .expect(403);
      await api(app)
        .post(`/api/v1/moderacion/casos/${disputa.id}/decidir`)
        .set(auth(otroModerador))
        .send({
          decision: 'restaurar',
          justificacion: 'El repositorio publico es de la propia candidata: queda demostrado.',
        })
        .expect(200);

      const filas = (await ranking()).body.ranking as { notaFinal: number }[];
      expect(filas[0].notaFinal).toBe(95); // vuelve al ranking
    });

    it('no se disputa lo que no esta confirmado ni un caso ajeno', async () => {
      const id = await abrirCaso(await evaluacion('alto'));
      await api(app)
        .post(`/api/v1/moderacion/casos/${id}/disputar`)
        .set(auth(ana))
        .send({ explicacion: 'Todavia no hay decision, pero quiero disputar igual.' })
        .expect(400);
      const luis = await registrarCandidato(app, 'luis@ejemplo.com');
      await api(app)
        .post(`/api/v1/moderacion/casos/${id}/disputar`)
        .set(auth(luis))
        .send({ explicacion: 'Intento disputar el caso de otra persona, que no es mio.' })
        .expect(404);
    });
  });

  describe('metricas y gestion', () => {
    it('cuenta casos, falsos positivos y casos vencidos', async () => {
      const a = await abrirCaso(await evaluacion('alto'));
      await abrirCaso(await evaluacion('alto', 70));
      await api(app)
        .post(`/api/v1/moderacion/casos/${a}/decidir`)
        .set(auth(moderador))
        .send({ decision: 'restaurar', justificacion: MOTIVO })
        .expect(200);
      await consultar(
        `update moderacion.casos set vence_en = now() - interval '1 hour' where estado = 'abierto'`,
      );

      const { body } = await api(app)
        .get('/api/v1/moderacion/metricas')
        .set(auth(admin))
        .expect(200);
      expect(body.casos).toMatchObject({ total: 2, abiertos: 1, restaurados: 1 });
      expect(body.tasaDeFalsosPositivos).toBe(1);
      expect(body.vencidosSinDecidir).toBe(1);
      await api(app).get('/api/v1/moderacion/metricas').set(auth(reclutador)).expect(403);
    });

    it('solo un administrador crea moderadores, y el nuevo puede entrar a la bandeja', async () => {
      const cuerpo = {
        correo: 'nueva@meritia.co',
        contrasena: 'una-frase-larga-y-dificil',
        nombreCompleto: 'Nueva Moderadora',
      };
      await api(app)
        .post('/api/v1/moderacion/moderadores')
        .set(auth(reclutador))
        .send(cuerpo)
        .expect(403);
      await api(app)
        .post('/api/v1/moderacion/moderadores')
        .set(auth(admin))
        .send(cuerpo)
        .expect(201);
      const { body } = await api(app)
        .post('/api/v1/autenticacion/login')
        .send({ correo: cuerpo.correo, contrasena: cuerpo.contrasena, cliente: 'apk' })
        .expect(200);
      await api(app)
        .get('/api/v1/moderacion/casos')
        .set({ Authorization: `Bearer ${body.tokenDeAcceso}` })
        .expect(200);
    });
  });
});
