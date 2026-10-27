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
 * Aislamiento de datos por empresa.
 *
 * Nace del criterio del paquete 5.1: "ningun reporte muestra datos de una
 * empresa distinta a la del reclutador autenticado". Un reporte solo puede
 * aislar lo que ya viene aislado, asi que la frontera se comprueba desde la
 * raiz: vacantes, banco de ejercicios y entregas.
 */
describe('integracion: empresas', () => {
  let app: INestApplication<Server>;
  let admin: Sesion;
  let reclutadorAcme: Sesion;
  let colegaAcme: Sesion;
  let reclutadorRival: Sesion;
  let candidato: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  const crearVacante = (dueno: Sesion) =>
    api(app)
      .post('/api/v1/vacantes')
      .set(auth(dueno))
      .send({
        titulo: 'Desarrollador backend junior',
        descripcion: 'Buscamos una persona para el equipo de plataforma.',
      })
      .expect(201);

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
    // Sin empresa: administrador de la plataforma.
    admin = await crearConRol(app, 'admin@meritia.com', 'administrador', null);
    reclutadorAcme = await crearConRol(app, 'ana@acme.com', 'reclutador', 'Acme');
    colegaAcme = await crearConRol(app, 'luis@acme.com', 'reclutador', 'Acme');
    reclutadorRival = await crearConRol(app, 'rita@rival.com', 'reclutador', 'Rival');
    candidato = await registrarCandidato(app, 'cand@ejemplo.com');
  });

  describe('alta de empresas y usuarios', () => {
    it('un administrador de plataforma crea la empresa y su primer reclutador', async () => {
      const { body: empresa } = await api(app)
        .post('/api/v1/empresas')
        .set(auth(admin))
        .send({ nombre: 'Tercera S.A.S.', sector: 'tecnologia' })
        .expect(201);
      expect(empresa).toMatchObject({
        nombre: 'Tercera S.A.S.',
        sector: 'tecnologia',
        activa: true,
      });

      const { body: usuario } = await api(app)
        .post(`/api/v1/empresas/${empresa.id}/usuarios`)
        .set(auth(admin))
        .send({
          correo: 'nuevo@tercera.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Persona Nueva',
          rol: 'reclutador',
        })
        .expect(201);
      expect(usuario).toMatchObject({ rol: 'reclutador', idEmpresa: empresa.id });

      // Y puede entrar con esa cuenta.
      const { body: sesion } = await api(app)
        .post('/api/v1/autenticacion/login')
        .send({
          correo: 'nuevo@tercera.com',
          contrasena: 'una-frase-larga-y-dificil',
          cliente: 'apk',
        })
        .expect(200);
      expect(sesion.rol).toBe('reclutador');
    });

    it('el nombre de empresa no se repite, sin importar mayusculas', async () => {
      await api(app)
        .post('/api/v1/empresas')
        .set(auth(admin))
        .send({ nombre: 'Unica', sector: 'comercio' })
        .expect(201);
      await api(app)
        .post('/api/v1/empresas')
        .set(auth(admin))
        .send({ nombre: 'UNICA', sector: 'comercio' })
        .expect(409);
    });

    it('el registro publico crea candidatos sin empresa, y no admite rol ni empresa', async () => {
      const [fila] = await consultar<{ rol: string; id_empresa: string | null }>(
        'select rol, id_empresa from autenticacion.usuarios where id = $1',
        [candidato.id],
      );
      expect(fila).toMatchObject({ rol: 'candidato', id_empresa: null });

      await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({
          correo: 'colado@ejemplo.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Persona Colada',
          rol: 'administrador',
        })
        .expect(400);
    });

    it('solo la plataforma crea empresas; un candidato o reclutador no llegan', async () => {
      await api(app)
        .post('/api/v1/empresas')
        .set(auth(reclutadorAcme))
        .send({ nombre: 'Inventada', sector: 'servicios' })
        .expect(403);
      await api(app)
        .post('/api/v1/empresas')
        .set(auth(candidato))
        .send({ nombre: 'Inventada', sector: 'servicios' })
        .expect(403);
      await api(app).get('/api/v1/empresas').set(auth(candidato)).expect(403);
    });

    it('un administrador de una empresa no crea usuarios en otra', async () => {
      const adminAcme = await crearConRol(app, 'jefe@acme.com', 'administrador', 'Acme');
      const [rival] = await consultar<{ id: string }>(
        'select id from autenticacion.empresas where lower(nombre) = $1',
        ['rival'],
      );

      // 404 y no 403: no se le confirma que esa empresa exista.
      await api(app)
        .post(`/api/v1/empresas/${rival.id}/usuarios`)
        .set(auth(adminAcme))
        .send({
          correo: 'infiltrado@rival.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Persona Infiltrada',
          rol: 'reclutador',
        })
        .expect(404);

      await api(app)
        .post(`/api/v1/empresas/${uuid()}/usuarios`)
        .set(auth(admin))
        .send({
          correo: 'otra@ejemplo.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Persona Otra',
          rol: 'reclutador',
        })
        .expect(404);
    });
  });

  describe('sector y NIT: el dato con el que se responde "que tipo de empresas"', () => {
    const alta = (cuerpo: Record<string, unknown>) =>
      api(app).post('/api/v1/empresas').set(auth(admin)).send(cuerpo);

    it('guarda el sector y normaliza el NIT que se escribe con puntos', async () => {
      const { body } = await alta({
        nombre: 'Banco del Ejemplo',
        sector: 'financiero',
        nit: '890.903.938-8',
      }).expect(201);

      // Canonico: si la misma empresa se registrara una vez con puntos y otra
      // sin ellos, el indice unico no la reconoceria y quedaria duplicada.
      expect(body).toMatchObject({ sector: 'financiero', nit: '890903938-8' });

      const [fila] = await consultar<{ sector: string; nit: string }>(
        'select sector, nit from autenticacion.empresas where id = $1',
        [body.id],
      );
      expect(fila).toMatchObject({ sector: 'financiero', nit: '890903938-8' });
    });

    it('exige el sector, aunque la columna tenga valor por omision', async () => {
      // El valor por omision existe para las filas anteriores a la columna, no
      // para crear empresas sin clasificar.
      await alta({ nombre: 'Sin Clasificar' }).expect(400);
      await alta({ nombre: 'Inventado', sector: 'criptomonedas' }).expect(400);
    });

    it('rechaza el NIT cuyo digito de verificacion no cuadra', async () => {
      // Es el error real: alguien copia el NIT y se equivoca en el ultimo
      // numero. Sin esta comprobacion entra una empresa con un NIT que no
      // existe, y nadie se enteraria hasta la facturacion.
      const { body } = await alta({
        nombre: 'Digito Malo',
        sector: 'industria',
        nit: '890903938-7',
      }).expect(400);
      expect(String(body.mensaje)).toMatch(/digito de verificacion/i);
    });

    it('rechaza la forma equivocada antes de calcular nada', async () => {
      // Dos 400 distintos a proposito: este es de forma, el anterior de
      // calculo. Quien se equivoco necesita saber en que.
      const { body } = await alta({
        nombre: 'Forma Mala',
        sector: 'industria',
        nit: '890903938',
      }).expect(400);
      // El de forma llega por el ValidationPipe, asi que el detalle va por
      // campo en `errores` y no en el mensaje general.
      expect(JSON.stringify(body.errores)).toMatch(/nit.*digito de verificacion/is);

      await alta({ nombre: 'Forma Mala 2', sector: 'industria', nit: 'no-es-un-nit' }).expect(400);
    });

    it('el NIT no se repite, y el conflicto dice que choco el NIT y no el nombre', async () => {
      await alta({ nombre: 'Primera', sector: 'salud', nit: '890903938-8' }).expect(201);

      const { body } = await alta({
        nombre: 'Segunda, otro nombre',
        sector: 'salud',
        nit: '890.903.938-8',
      }).expect(409);

      // Si el mensaje hablara del nombre, quien lo lee corregiria el nombre,
      // que estaba bien, y volveria a chocar.
      expect(String(body.mensaje)).toMatch(/NIT/);
    });

    it('varias empresas sin NIT conviven: el indice unico es parcial', async () => {
      await alta({ nombre: 'Sin NIT Uno', sector: 'educacion' }).expect(201);
      await alta({ nombre: 'Sin NIT Dos', sector: 'educacion' }).expect(201);
    });
  });

  describe('CRITERIO: nadie ve los datos de otra empresa', () => {
    it('la vacante nace con la empresa de quien la crea, no con la del cuerpo', async () => {
      const { body } = await crearVacante(reclutadorAcme);
      const [fila] = await consultar<{ id_empresa: string }>(
        'select id_empresa from vacantes.vacantes where id = $1',
        [body.id],
      );
      const [acme] = await consultar<{ id: string }>(
        'select id from autenticacion.empresas where lower(nombre) = $1',
        ['acme'],
      );
      expect(fila.id_empresa).toBe(acme.id);
    });

    it('un reclutador de otra empresa no ve, edita ni cierra la vacante', async () => {
      const { body } = await crearVacante(reclutadorAcme);

      await api(app).get(`/api/v1/vacantes/${body.id}`).set(auth(reclutadorRival)).expect(404);
      await api(app)
        .patch(`/api/v1/vacantes/${body.id}`)
        .set(auth(reclutadorRival))
        .send({ titulo: 'Secuestrada' })
        .expect(404);
      await api(app)
        .post(`/api/v1/vacantes/${body.id}/cerrar`)
        .set(auth(reclutadorRival))
        .expect(404);

      const { body: suyas } = await api(app)
        .get('/api/v1/vacantes')
        .set(auth(reclutadorRival))
        .expect(200);
      expect(suyas).toHaveLength(0);
    });

    it('un colega de la MISMA empresa si la ve y la gestiona', async () => {
      const { body } = await crearVacante(reclutadorAcme);

      await api(app).get(`/api/v1/vacantes/${body.id}`).set(auth(colegaAcme)).expect(200);
      const { body: editada } = await api(app)
        .patch(`/api/v1/vacantes/${body.id}`)
        .set(auth(colegaAcme))
        .send({ titulo: 'Desarrollador backend semi senior' })
        .expect(200);
      expect(editada.titulo).toBe('Desarrollador backend semi senior');

      const { body: listado } = await api(app)
        .get('/api/v1/vacantes')
        .set(auth(colegaAcme))
        .expect(200);
      expect(listado).toHaveLength(1);
    });

    it('el banco de ejercicios es de la empresa: el colega lo ve, la otra empresa no', async () => {
      const idEjercicio = await crearEjercicioEnElBanco(app, reclutadorAcme, 'Ejercicio de Acme');

      await api(app).get(`/api/v1/ejercicios/${idEjercicio}`).set(auth(colegaAcme)).expect(200);
      await api(app)
        .get(`/api/v1/ejercicios/${idEjercicio}`)
        .set(auth(reclutadorRival))
        .expect(404);

      const { body: banco } = await api(app)
        .get('/api/v1/ejercicios')
        .set(auth(reclutadorRival))
        .expect(200);
      expect(banco).toHaveLength(0);
    });

    it('no se puede asociar a una vacante un ejercicio de otra empresa', async () => {
      const ajeno = await crearEjercicioEnElBanco(app, reclutadorRival, 'Ejercicio de Rival');
      const { body } = await crearVacante(reclutadorAcme);

      const { body: error } = await api(app)
        .put(`/api/v1/vacantes/${body.id}/ejercicios`)
        .set(auth(reclutadorAcme))
        .send({ idsDeEjercicios: [ajeno] })
        .expect(400);
      expect(error.mensaje).toMatch(/no existen en el banco/);
    });

    it('un administrador de plataforma ve todo, pero no crea vacantes sin empresa', async () => {
      await crearVacante(reclutadorAcme);
      await crearVacante(reclutadorRival);

      const { body: todas } = await api(app).get('/api/v1/vacantes').set(auth(admin)).expect(200);
      expect(todas).toHaveLength(2);

      const { body: error } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(admin))
        .send({ titulo: 'Sin empresa detras', descripcion: 'Creada por la plataforma, sin dueno.' })
        .expect(400);
      expect(error.mensaje).toMatch(/no pertenece a ninguna empresa/);
    });
  });

  describe('la sesion dice a que empresa perteneces', () => {
    it('el endpoint de identidad devuelve la empresa, y un candidato no tiene', async () => {
      const { body: deReclutador } = await api(app)
        .get('/api/v1/autenticacion/yo')
        .set(auth(reclutadorAcme))
        .expect(200);
      expect(deReclutador.idEmpresa).toEqual(expect.any(String));

      const { body: deCandidato } = await api(app)
        .get('/api/v1/autenticacion/yo')
        .set(auth(candidato))
        .expect(200);
      expect(deCandidato.idEmpresa).toBeNull();
    });
  });

  describe('la base guarda las reglas, no solo el codigo', () => {
    it('un reclutador sin empresa o un candidato con empresa no caben en la tabla', async () => {
      await expect(
        consultar('update autenticacion.usuarios set id_empresa = null where id = $1', [
          reclutadorAcme.id,
        ]),
      ).rejects.toThrow(/ck_usuario_empresa/);

      const [acme] = await consultar<{ id: string }>(
        'select id from autenticacion.empresas where lower(nombre) = $1',
        ['acme'],
      );
      await expect(
        consultar('update autenticacion.usuarios set id_empresa = $1 where id = $2', [
          acme.id,
          candidato.id,
        ]),
      ).rejects.toThrow(/ck_usuario_empresa/);
    });
  });
});
