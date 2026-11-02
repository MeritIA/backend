import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import {
  api,
  consultar,
  crearConRol,
  levantarAplicacion,
  registrarCandidato,
  type Sesion,
} from './ayudas.js';

/**
 * El vocabulario de habilidades (ADR-0017) y la invitacion automatica (A04).
 *
 * Las dos cosas juntas porque se tocan: el vocabulario cambia el numero con el
 * que la invitacion automatica decide.
 */
describe('integracion: vocabulario de habilidades e invitacion automatica', () => {
  let app: INestApplication<Server>;
  let admin: Sesion;
  let reclutador: Sesion;
  let candidato: Sesion;
  let otroCandidato: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });
  let contador = 0;

  async function ejercicioCon(criterios: { nombre: string; peso: number }[]): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/ejercicios')
      .set(auth(reclutador))
      .send({
        titulo: `Ejercicio ${++contador}`,
        enunciado: 'Enunciado de prueba suficientemente largo para pasar la validacion del DTO.',
        criterios: criterios.map((c) => ({
          nombre: c.nombre,
          descripcion: 'Descripcion del criterio, con largo suficiente para el DTO.',
          peso: c.peso,
          escalaMaxima: 5,
        })),
      })
      .expect(201);
    return body.id as string;
  }

  async function vacanteCon(idsDeEjercicios: string[]): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(reclutador))
      .send({
        titulo: `Vacante ${++contador}`,
        descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
      })
      .expect(201);
    const id = body.id as string;
    await api(app)
      .put(`/api/v1/vacantes/${id}/ejercicios`)
      .set(auth(reclutador))
      .send({ idsDeEjercicios })
      .expect(200);
    await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(200);
    return id;
  }

  async function calificar(
    quien: Sesion,
    idVacante: string,
    idEjercicio: string,
    notas: { criterio: string; puntaje: number }[],
  ): Promise<void> {
    const [{ id_empresa: idEmpresa }] = await consultar<{ id_empresa: string }>(
      `select id_empresa from autenticacion.usuarios where id = $1`,
      [reclutador.id],
    );
    const [evaluacion] = await consultar<{ id: string }>(
      `insert into evaluacion.evaluaciones
         (id_entrega, id_vacante, id_candidato, id_empresa, id_ejercicio, id_version,
          nota_final, proveedor, modelo, archivos, riesgo_inyeccion, creada_en)
       values (gen_random_uuid(), $1, $2, $3, $4, gen_random_uuid(),
               80, 'gemini', 'gemini-3.5-flash', 1, 'ninguno', now())
       returning id`,
      [idVacante, quien.id, idEmpresa, idEjercicio],
    );
    for (const [orden, nota] of notas.entries()) {
      await consultar(
        `insert into evaluacion.calificaciones_criterio
           (id_evaluacion, orden, criterio, puntaje, escala_maxima, peso, evidencia)
         values ($1, $2, $3, $4, 5, 100, 'Evidencia de prueba.')`,
        [evaluacion.id, orden, nota.criterio, nota.puntaje],
      );
    }
  }

  const afinidadDe = async (quien: Sesion, idVacante: string) => {
    const { body } = await api(app).get('/api/v1/reportes/afinidad').set(auth(quien)).expect(200);
    return body.find((o: { id: string }) => o.id === idVacante)?.afinidad;
  };

  const encender = (
    idVacante: string,
    politica: { activa: boolean; umbral?: number | null; cupo?: number | null },
  ) =>
    api(app)
      .put(`/api/v1/vacantes/${idVacante}/invitacion-automatica`)
      .set(auth(reclutador))
      .send(politica);

  const estaInvitado = async (idVacante: string, quien: Sesion) =>
    (
      await consultar(
        `select 1 from vacantes.vacante_candidatos where id_vacante = $1 and id_candidato = $2`,
        [idVacante, quien.id],
      )
    ).length === 1;

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
    admin = await crearConRol(app, 'admin@ejemplo.com', 'administrador', null);
    reclutador = await crearConRol(app, 'recl@ejemplo.com', 'reclutador');
    candidato = await registrarCandidato(app, 'cand@ejemplo.com');
    otroCandidato = await registrarCandidato(app, 'otro@ejemplo.com');
    contador = 0;
  }, 60_000);

  // -------------------------------------------------------------------------

  describe('el vocabulario une sinonimos, que era el limite del ADR-0016', () => {
    it('sin vocabulario, "Legibilidad" y "Claridad del codigo" no se encuentran', async () => {
      const viejo = await ejercicioCon([{ nombre: 'Legibilidad', peso: 100 }]);
      const vieja = await vacanteCon([viejo]);
      await calificar(candidato, vieja, viejo, [{ criterio: 'Legibilidad', puntaje: 5 }]);

      const nueva = await vacanteCon([
        await ejercicioCon([{ nombre: 'Claridad del codigo', peso: 100 }]),
      ]);

      // Este es el limite que el ADR-0016 dejo escrito.
      expect((await afinidadDe(candidato, nueva)).porcentaje).toBeNull();
    });

    it('con el alias registrado, la MISMA evidencia ya cuenta', async () => {
      const viejo = await ejercicioCon([{ nombre: 'Legibilidad', peso: 100 }]);
      const vieja = await vacanteCon([viejo]);
      await calificar(candidato, vieja, viejo, [{ criterio: 'Legibilidad', puntaje: 5 }]);
      const nueva = await vacanteCon([
        await ejercicioCon([{ nombre: 'Claridad del codigo', peso: 100 }]),
      ]);

      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send({
          nombre: 'Claridad del codigo',
          descripcion: 'Nombres descriptivos, estructura simple y comentarios donde aportan.',
          alias: ['Legibilidad', 'Codigo legible'],
        })
        .expect(201);

      // Sin tocar ni una calificacion: el numero cambia porque el vocabulario
      // cambio. Es lo que el ADR-0017 llama recalculo en vivo.
      const afinidad = await afinidadDe(candidato, nueva);
      expect(afinidad.porcentaje).toBe(100);
      expect(afinidad.cobertura).toBe(100);
    });

    it('el perfil agrupa los sinonimos en UNA habilidad, no en dos a medias', async () => {
      const e1 = await ejercicioCon([{ nombre: 'Legibilidad', peso: 100 }]);
      const v1 = await vacanteCon([e1]);
      await calificar(candidato, v1, e1, [{ criterio: 'Legibilidad', puntaje: 5 }]);
      await calificar(candidato, v1, e1, [{ criterio: 'Claridad del codigo', puntaje: 1 }]);

      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send({
          nombre: 'Claridad del codigo',
          descripcion: 'Nombres descriptivos, estructura simple y comentarios donde aportan.',
          alias: ['Legibilidad'],
        })
        .expect(201);

      const { body } = await api(app)
        .get('/api/v1/reportes/mi-perfil-de-habilidades')
        .set(auth(candidato))
        .expect(200);

      expect(body).toHaveLength(1);
      // Media de 5/5 y 1/5, con las dos calificaciones contadas.
      expect(body[0]).toMatchObject({ nivel: 60, veces: 2 });
    });
  });

  describe('las reglas del catalogo', () => {
    const habilidad = (nombre: string, alias?: string[]) => ({
      nombre,
      descripcion: 'Descripcion con el largo suficiente para pasar la validacion del DTO.',
      alias,
    });

    it('solo un administrador de plataforma escribe el vocabulario', async () => {
      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(reclutador))
        .send(habilidad('Algo'))
        .expect(403);
      // Pero cualquiera lo lee: un reclutador necesita ver que nombres existen.
      await api(app).get('/api/v1/habilidades').set(auth(reclutador)).expect(200);
      await api(app).get('/api/v1/habilidades').set(auth(candidato)).expect(200);
    });

    it('un termino no puede ser alias de dos habilidades', async () => {
      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send(habilidad('Claridad del codigo', ['Legibilidad']))
        .expect(201);

      const { body } = await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send(habilidad('Comunicacion escrita', ['Legibilidad']))
        .expect(409);
      expect(body.mensaje).toMatch(/alias/i);
    });

    it('un alias no puede ser el nombre canonico de otra habilidad', async () => {
      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send(habilidad('Correccion funcional'))
        .expect(201);

      // Esta es la regla que la base NO puede imponer, porque son dos tablas.
      const { body } = await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send(habilidad('Comunicacion escrita', ['Correccion funcional']))
        .expect(409);
      expect(body.mensaje).toMatch(/nombre de la habilidad/i);
    });

    it('la misma habilidad con otros acentos y mayusculas choca', async () => {
      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send(habilidad('Correccion funcional'))
        .expect(201);
      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send(habilidad('  CORRECCIÓN   Funcional '))
        .expect(409);
    });

    it('un alias igual al propio nombre se rechaza por inutil, no en silencio', async () => {
      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send(habilidad('Correccion funcional', ['correccion funcional']))
        .expect(400);
    });

    it('retirar no borra: sigue resolviendo lo que ya se escribio', async () => {
      const { body: creada } = await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send(habilidad('Claridad del codigo', ['Legibilidad']))
        .expect(201);

      await api(app).delete(`/api/v1/habilidades/${creada.id}`).set(auth(admin)).expect(200);

      // Ya no se ofrece...
      const { body: catalogo } = await api(app)
        .get('/api/v1/habilidades')
        .set(auth(admin))
        .expect(200);
      expect(catalogo).toHaveLength(0);

      // ...pero sigue uniendo los nombres: un perfil no se mueve porque alguien
      // edite un catalogo.
      const e = await ejercicioCon([{ nombre: 'Legibilidad', peso: 100 }]);
      const v = await vacanteCon([e]);
      await calificar(candidato, v, e, [{ criterio: 'Legibilidad', puntaje: 5 }]);
      const nueva = await vacanteCon([
        await ejercicioCon([{ nombre: 'Claridad del codigo', peso: 100 }]),
      ]);
      expect((await afinidadDe(candidato, nueva)).porcentaje).toBe(100);
    });
  });

  // -------------------------------------------------------------------------

  describe('invitacion automatica: modo abierto', () => {
    it('acepta e invita de verdad en la misma peticion del candidato', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true }).expect(200);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);

      // La respuesta del POST ya dice el estado final: no hay un "en revision"
      // que luego cambie por detras.
      expect(body.estado).toBe('aceptada');
      expect(body.decisionAutomatica).toBe(true);
      expect(await estaInvitado(idVacante, candidato)).toBe(true);
      await api(app).get(`/api/v1/vacantes/${idVacante}`).set(auth(candidato)).expect(200);
    });

    it('un candidato sin ninguna prueba hecha entra: el modo abierto no mira el perfil', async () => {
      // La trampa del principiante no existe en este modo.
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true }).expect(200);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      expect(body.estado).toBe('aceptada');
      expect(body.afinidadAlDecidir).toBeNull();
    });

    it('el cupo corta, y quien llega despues queda en revision, NO rechazado', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true, cupo: 1 }).expect(200);

      const { body: primero } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      const { body: segundo } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(otroCandidato))
        .expect(201);

      expect(primero.estado).toBe('aceptada');
      // La regla que hace segura toda la funcion: lo peor que pasa es esperar.
      expect(segundo.estado).toBe('en_revision');
      expect(await estaInvitado(idVacante, otroCandidato)).toBe(false);

      // Y una persona lo puede aceptar a mano, sin tocar el cupo.
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postulaciones/${otroCandidato.id}/aceptar`)
        .set(auth(reclutador))
        .expect(200);
      expect(await estaInvitado(idVacante, otroCandidato)).toBe(true);
    });
  });

  describe('invitacion automatica: con umbral', () => {
    /** Deja al candidato con un nivel demostrado en la habilidad que se pedira. */
    async function conNivel(habilidad: string, puntaje: number): Promise<void> {
      const e = await ejercicioCon([{ nombre: habilidad, peso: 100 }]);
      const v = await vacanteCon([e]);
      await calificar(candidato, v, e, [{ criterio: habilidad, puntaje }]);
    }

    it('por encima del umbral entra, y queda guardado con que numero', async () => {
      await conNivel('Correccion funcional', 5);
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true, umbral: 70 }).expect(200);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      expect(body.estado).toBe('aceptada');
      // La auditoria de por que la maquina dijo si.
      expect(body.afinidadAlDecidir).toBe(100);
      expect(body.idUsuarioQueDecidio).toBe(reclutador.id);
    });

    it('por debajo del umbral NO se rechaza: queda para una persona', async () => {
      await conNivel('Correccion funcional', 1);
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true, umbral: 70 }).expect(200);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      expect(body.estado).toBe('en_revision');
      expect(body.decisionAutomatica).toBe(false);
      expect(await estaInvitado(idVacante, candidato)).toBe(false);
    });

    it('sin evidencia se abstiene: es la salida de la trampa del principiante', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Algo que nunca hizo', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true, umbral: 50 }).expect(200);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      expect(body.estado).toBe('en_revision');
    });

    it('el vocabulario cambia a quien entra solo', async () => {
      // Lo mismo demostrado, otro nombre: sin alias no alcanza el umbral.
      await conNivel('Legibilidad', 5);
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Claridad del codigo', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true, umbral: 70 }).expect(200);

      const { body: sinAlias } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      expect(sinAlias.estado).toBe('en_revision');

      // Se registra el alias y se vuelve a aplicar la politica a lo pendiente.
      await api(app)
        .post('/api/v1/habilidades')
        .set(auth(admin))
        .send({
          nombre: 'Claridad del codigo',
          descripcion: 'Nombres descriptivos, estructura simple y comentarios donde aportan.',
          alias: ['Legibilidad'],
        })
        .expect(201);

      const { body: reaplicado } = await encender(idVacante, {
        activa: true,
        umbral: 70,
      }).expect(200);
      expect(reaplicado.aceptadas).toBe(1);
      expect(await estaInvitado(idVacante, candidato)).toBe(true);
    });
  });

  describe('encender la politica procesa lo que ya estaba esperando', () => {
    it('quien llevaba dias en revision entra, sin volver a postularse', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(otroCandidato))
        .expect(201);

      const { body } = await encender(idVacante, { activa: true }).expect(200);
      expect(body.aceptadas).toBe(2);
      expect(await estaInvitado(idVacante, candidato)).toBe(true);
      expect(await estaInvitado(idVacante, otroCandidato)).toBe(true);
    });

    it('con cupo, lo coge quien se postulo antes', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(otroCandidato))
        .expect(201);

      const { body } = await encender(idVacante, { activa: true, cupo: 1 }).expect(200);
      expect(body.aceptadas).toBe(1);
      expect(await estaInvitado(idVacante, candidato)).toBe(true);
      expect(await estaInvitado(idVacante, otroCandidato)).toBe(false);
    });

    it('un rechazo ya decidido NO se reabre al encender la politica', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postulaciones/${candidato.id}/rechazar`)
        .set(auth(reclutador))
        .send({ motivo: 'Buscamos experiencia especifica en conciliacion de pagos.' })
        .expect(200);

      const { body } = await encender(idVacante, { activa: true }).expect(200);
      expect(body.aceptadas).toBe(0);
      expect(await estaInvitado(idVacante, candidato)).toBe(false);
    });
  });

  describe('las puertas de la politica', () => {
    it('apagarla deja de invitar, y lo ya invitado se queda', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true }).expect(200);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);

      await encender(idVacante, { activa: false }).expect(200);
      const { body } = await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(otroCandidato))
        .expect(201);

      expect(body.estado).toBe('en_revision');
      expect(await estaInvitado(idVacante, candidato)).toBe(true);
    });

    it('un reclutador de otra empresa no la configura, y recibe 404', async () => {
      const otro = await crearConRol(app, 'otro-recl@ejemplo.com', 'reclutador', 'Otra empresa');
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await api(app)
        .put(`/api/v1/vacantes/${idVacante}/invitacion-automatica`)
        .set(auth(otro))
        .send({ activa: true })
        .expect(404);
    });

    it('un candidato no la configura', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await api(app)
        .put(`/api/v1/vacantes/${idVacante}/invitacion-automatica`)
        .set(auth(candidato))
        .send({ activa: true })
        .expect(403);
    });

    it('un umbral fuera de 0 a 100 se rechaza', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await encender(idVacante, { activa: true, umbral: 101 }).expect(400);
      await encender(idVacante, { activa: true, umbral: -1 }).expect(400);
      await encender(idVacante, { activa: true, cupo: -1 }).expect(400);
    });

    it('en una vacante cerrada no se enciende', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await api(app).post(`/api/v1/vacantes/${idVacante}/cerrar`).set(auth(reclutador)).expect(200);
      await encender(idVacante, { activa: true }).expect(400);
    });
  });
});
