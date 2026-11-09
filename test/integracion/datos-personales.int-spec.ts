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
  type Sesion,
} from './ayudas.js';

/**
 * «Descargar mis datos» y «Eliminar cuenta» (B24, Ley 1581), contra PostgreSQL.
 */
describe('integracion: datos personales del titular', () => {
  let app: INestApplication<Server>;
  let ana: Sesion;
  let luis: Sesion;
  let reclutador: Sesion;
  const PASS = 'una-frase-larga-y-dificil';
  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

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
    ana = await registrarCandidato(app, 'ana@ejemplo.com', 'Ana Maria Rojas');
    luis = await registrarCandidato(app, 'luis@ejemplo.com', 'Luis Perez');
    reclutador = await crearConRol(app, 'laura@empresa-a.com', 'reclutador', 'Empresa A');
  }, 60_000);

  async function conPostulacionYEntrega(): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(reclutador))
      .send({ titulo: 'Backend', descripcion: 'Buscamos una persona para plataforma.' })
      .expect(201);
    const id = body.id as string;
    const ej = await crearEjercicioEnElBanco(app, reclutador, 'Ejercicio');
    await api(app)
      .put(`/api/v1/vacantes/${id}/ejercicios`)
      .set(auth(reclutador))
      .send({ idsDeEjercicios: [ej] })
      .expect(200);
    await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(200);
    await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(ana)).expect(201);
    return id;
  }

  describe('descargar mis datos', () => {
    it('trae lo propio, con el nombre y el correo, y nada de otra persona', async () => {
      await conPostulacionYEntrega();
      const { body } = await api(app).get('/api/v1/reportes/mis-datos').set(auth(ana)).expect(200);
      expect(body.perfil).toMatchObject({
        nombreCompleto: 'Ana Maria Rojas',
        correo: 'ana@ejemplo.com',
      });
      expect(body.postulaciones).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain('Luis');

      const { body: deLuis } = await api(app)
        .get('/api/v1/reportes/mis-datos')
        .set(auth(luis))
        .expect(200);
      expect(deLuis.postulaciones).toHaveLength(0);
    });

    it('sin sesion no se entra', async () => {
      await api(app).get('/api/v1/reportes/mis-datos').expect(401);
    });
  });

  describe('eliminar mi cuenta: la foto de verificacion se va con ella', () => {
    it('borra la foto del bucket y deja el registro de que existio', async () => {
      const idVacante = await conPostulacionYEntrega();
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: ana.id })
        .expect(200);
      const { body: entrega } = await api(app)
        .post('/api/v1/entregas')
        .set(auth(ana))
        .field('idVacante', idVacante)
        .field(
          'idEjercicio',
          (
            await consultar<{ id_ejercicio: string }>(
              'select id_ejercicio from vacantes.vacante_ejercicios where id_vacante = $1',
              [idVacante],
            )
          )[0].id_ejercicio,
        )
        .attach('archivo', Buffer.from('mi solucion'), 'solucion.zip')
        .expect(201);
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('foto')]);
      await api(app)
        .post(`/api/v1/entregas/${entrega.id}/verificacion`)
        .set(auth(ana))
        .field('modalidad', 'camara')
        .attach('foto', jpeg, 'cara.jpg')
        .expect(201);

      await api(app)
        .delete('/api/v1/autenticacion/cuenta')
        .set(auth(ana))
        .send({ contrasena: PASS })
        .expect(204);
      await new Promise((r) => setTimeout(r, 500));

      const [fila] = await consultar<{ clave: string | null; purgada_en: Date | null }>(
        'select clave, purgada_en from entregas.verificaciones where id_entrega = $1',
        [entrega.id],
      );
      expect(fila.clave).toBeNull();
      expect(fila.purgada_en).not.toBeNull();
    });
  });

  describe('eliminar mi cuenta', () => {
    it('pide la contrasena correcta', async () => {
      await api(app)
        .delete('/api/v1/autenticacion/cuenta')
        .set(auth(ana))
        .send({ contrasena: 'otra-contrasena-cualquiera' })
        .expect(401);
    });

    it('anonimiza, cierra la sesion, impide volver a entrar y borra las postulaciones', async () => {
      const idVacante = await conPostulacionYEntrega();
      await api(app)
        .delete('/api/v1/autenticacion/cuenta')
        .set(auth(ana))
        .send({ contrasena: PASS })
        .expect(204);

      // El token anterior ya no sirve, y las credenciales tampoco.
      await api(app).get('/api/v1/autenticacion/yo').set(auth(ana)).expect(401);
      await api(app)
        .post('/api/v1/autenticacion/login')
        .send({ correo: 'ana@ejemplo.com', contrasena: PASS, cliente: 'apk' })
        .expect(401);

      const [fila] = await consultar<{ activo: boolean }>(
        'select activo from autenticacion.usuarios where id = $1',
        [ana.id],
      );
      expect(fila.activo).toBe(false);

      // El suscriptor corre despues de responder: se espera a que borre.
      await new Promise((r) => setTimeout(r, 300));
      const postulaciones = await consultar(
        'select 1 from vacantes.postulaciones where id_vacante = $1 and id_candidato = $2',
        [idVacante, ana.id],
      );
      expect(postulaciones).toHaveLength(0);
    });
  });
});
