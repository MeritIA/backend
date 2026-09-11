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
  uuid,
  type Sesion,
} from './ayudas.js';

/** Criterios de aceptacion del paquete 2.2, automatizados. */
describe('integracion: vacantes', () => {
  let app: INestApplication<Server>;
  let reclutador: Sesion;
  let otroReclutador: Sesion;
  let candidato: Sesion;
  let otroCandidato: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  async function crearVacante(dueno = reclutador): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(dueno))
      .send({
        titulo: 'Desarrollador backend junior',
        descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
      })
      .expect(201);
    return body.id as string;
  }

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
    reclutador = await crearConRol(app, 'recl1@ejemplo.com', 'reclutador');
    otroReclutador = await crearConRol(app, 'recl2@ejemplo.com', 'reclutador');
    candidato = await registrarCandidato(app, 'cand1@ejemplo.com');
    otroCandidato = await registrarCandidato(app, 'cand2@ejemplo.com');
  });

  describe('CRITERIO: el reclutador crea, edita y cierra', () => {
    it('crea en borrador y a su nombre', async () => {
      const { body } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Backend junior', descripcion: 'Descripcion suficientemente larga.' })
        .expect(201);

      expect(body.estado).toBe('borrador');
      expect(body.idReclutador).toBe(reclutador.id);
    });

    it('no deja elegir el estado ni el dueno desde el cuerpo', async () => {
      for (const extra of [{ estado: 'publicada' }, { idReclutador: uuid() }]) {
        await api(app)
          .post('/api/v1/vacantes')
          .set(auth(reclutador))
          .send({
            titulo: 'Backend junior',
            descripcion: 'Descripcion suficientemente larga.',
            ...extra,
          })
          .expect(400);
      }
    });

    it('edita y cierra', async () => {
      const id = await crearVacante();

      const editada = await api(app)
        .patch(`/api/v1/vacantes/${id}`)
        .set(auth(reclutador))
        .send({ ubicacion: 'Bogota (hibrido)' })
        .expect(200);
      expect(editada.body.ubicacion).toBe('Bogota (hibrido)');

      const cerrada = await api(app)
        .post(`/api/v1/vacantes/${id}/cerrar`)
        .set(auth(reclutador))
        .expect(200);
      expect(cerrada.body.estado).toBe('cerrada');
      expect(cerrada.body.cerradaEn).not.toBeNull();
    });

    it('una vacante cerrada no se edita, ni se cierra dos veces, ni se publica', async () => {
      const id = await crearVacante();
      await api(app).post(`/api/v1/vacantes/${id}/cerrar`).set(auth(reclutador)).expect(200);

      await api(app)
        .patch(`/api/v1/vacantes/${id}`)
        .set(auth(reclutador))
        .send({ titulo: 'Cambiar tras cerrar' })
        .expect(400);
      await api(app).post(`/api/v1/vacantes/${id}/cerrar`).set(auth(reclutador)).expect(400);
      await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(400);
    });
  });

  describe('CRITERIO: no se publica sin al menos un ejercicio', () => {
    it('rechaza publicar una vacante sin ejercicios', async () => {
      const id = await crearVacante();
      const { body } = await api(app)
        .post(`/api/v1/vacantes/${id}/publicar`)
        .set(auth(reclutador))
        .expect(400);
      expect(body.mensaje).toMatch(/al menos un ejercicio/i);

      const [fila] = await consultar<{ estado: string }>(
        'select estado from vacantes.vacantes where id = $1',
        [id],
      );
      expect(fila.estado).toBe('borrador');
    });

    it('publica cuando hay ejercicios asociados', async () => {
      const id = await crearVacante();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [uuid(), uuid()] })
        .expect(200);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${id}/publicar`)
        .set(auth(reclutador))
        .expect(200);
      expect(body.estado).toBe('publicada');
      expect(body.publicadaEn).not.toBeNull();
    });

    it('guarda la relacion en su propio esquema, con el orden', async () => {
      const id = await crearVacante();
      const e1 = uuid();
      const e2 = uuid();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [e1, e2] })
        .expect(200);

      const filas = await consultar<{ id_ejercicio: string; orden: number }>(
        'select id_ejercicio, orden from vacantes.vacante_ejercicios where id_vacante = $1 order by orden',
        [id],
      );
      expect(filas.map((f) => f.id_ejercicio)).toEqual([e1, e2]);
    });

    it('rechaza ejercicios repetidos y listas vacias', async () => {
      const id = await crearVacante();
      const e = uuid();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [e, e] })
        .expect(400);
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [] })
        .expect(400);
    });

    it('NO deja cambiar los ejercicios de una vacante ya publicada', async () => {
      // Cambiarlos dejaria a dos candidatos del mismo proceso resolviendo
      // pruebas distintas, y sus resultados dejarian de ser comparables.
      const id = await crearVacante();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [uuid()] })
        .expect(200);
      await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(200);

      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [uuid()] })
        .expect(400);
    });
  });

  describe('CRITERIO: el candidato solo consulta las vacantes asignadas', () => {
    async function vacantePublicada(): Promise<string> {
      const id = await crearVacante();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [uuid()] })
        .expect(200);
      await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(200);
      return id;
    }

    it('sin invitacion no ve nada, ni por listado ni por identificador', async () => {
      const id = await vacantePublicada();

      const { body } = await api(app).get('/api/v1/vacantes').set(auth(candidato)).expect(200);
      expect(body).toHaveLength(0);

      await api(app).get(`/api/v1/vacantes/${id}`).set(auth(candidato)).expect(404);
    });

    it('invitado, la ve', async () => {
      const id = await vacantePublicada();
      await api(app)
        .post(`/api/v1/vacantes/${id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);

      const { body } = await api(app).get('/api/v1/vacantes').set(auth(candidato)).expect(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(id);

      await api(app).get(`/api/v1/vacantes/${id}`).set(auth(candidato)).expect(200);
    });

    it('invitar a uno no se la muestra a otro', async () => {
      const id = await vacantePublicada();
      await api(app)
        .post(`/api/v1/vacantes/${id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);

      const { body } = await api(app).get('/api/v1/vacantes').set(auth(otroCandidato)).expect(200);
      expect(body).toHaveLength(0);
      await api(app).get(`/api/v1/vacantes/${id}`).set(auth(otroCandidato)).expect(404);
    });

    it('un borrador no se muestra aunque el candidato este invitado', async () => {
      const id = await crearVacante();
      await api(app)
        .post(`/api/v1/vacantes/${id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);

      const { body } = await api(app).get('/api/v1/vacantes').set(auth(candidato)).expect(200);
      expect(body).toHaveLength(0);
    });

    it('invitar dos veces no duplica la asignacion', async () => {
      const id = await vacantePublicada();
      for (let i = 0; i < 2; i++) {
        await api(app)
          .post(`/api/v1/vacantes/${id}/candidatos`)
          .set(auth(reclutador))
          .send({ idCandidato: candidato.id })
          .expect(200);
      }
      expect(
        await consultar('select 1 from vacantes.vacante_candidatos where id_vacante = $1', [id]),
      ).toHaveLength(1);
    });
  });

  describe('acceso por recurso: cambiar un identificador no da acceso', () => {
    it('otro reclutador no ve, edita, publica ni cierra una vacante ajena', async () => {
      const id = await crearVacante();

      // 404 y no 403 en todos los casos: un 403 confirmaria que existe, y con
      // eso se sondea el catalogo de la competencia probando identificadores.
      await api(app).get(`/api/v1/vacantes/${id}`).set(auth(otroReclutador)).expect(404);
      await api(app)
        .patch(`/api/v1/vacantes/${id}`)
        .set(auth(otroReclutador))
        .send({ titulo: 'Secuestrada por otro' })
        .expect(404);
      await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(otroReclutador)).expect(404);
      await api(app).post(`/api/v1/vacantes/${id}/cerrar`).set(auth(otroReclutador)).expect(404);
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(otroReclutador))
        .send({ idsDeEjercicios: [uuid()] })
        .expect(404);
      await api(app)
        .post(`/api/v1/vacantes/${id}/candidatos`)
        .set(auth(otroReclutador))
        .send({ idCandidato: candidato.id })
        .expect(404);
    });

    it('y la vacante queda intacta tras los intentos', async () => {
      const id = await crearVacante();
      await api(app)
        .patch(`/api/v1/vacantes/${id}`)
        .set(auth(otroReclutador))
        .send({ titulo: 'Secuestrada por otro' })
        .expect(404);

      const { body } = await api(app)
        .get(`/api/v1/vacantes/${id}`)
        .set(auth(reclutador))
        .expect(200);
      expect(body.titulo).toBe('Desarrollador backend junior');
    });

    it('el listado de un reclutador no incluye las de sus colegas', async () => {
      await crearVacante(reclutador);
      await crearVacante(otroReclutador);

      const mias = await api(app).get('/api/v1/vacantes').set(auth(reclutador)).expect(200);
      expect(mias.body).toHaveLength(1);
      expect(mias.body[0].idReclutador).toBe(reclutador.id);
    });

    it('un candidato no crea, edita ni publica', async () => {
      const id = await crearVacante();
      await api(app)
        .post('/api/v1/vacantes')
        .set(auth(candidato))
        .send({ titulo: 'Vacante falsa', descripcion: 'Un candidato creando una oferta.' })
        .expect(403);
      await api(app)
        .patch(`/api/v1/vacantes/${id}`)
        .set(auth(candidato))
        .send({ titulo: 'Editada por un candidato' })
        .expect(403);
      await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(candidato)).expect(403);
    });
  });

  describe('validacion de entrada', () => {
    it('rechaza un identificador que no es UUID', async () => {
      await api(app).get('/api/v1/vacantes/no-es-uuid').set(auth(reclutador)).expect(400);
    });

    it('rechaza titulo corto y descripcion corta', async () => {
      await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'ab', descripcion: 'Descripcion suficientemente larga para pasar.' })
        .expect(400);
      await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Titulo valido', descripcion: 'corta' })
        .expect(400);
    });

    it('una vacante inexistente devuelve 404 y no una traza', async () => {
      const { body } = await api(app)
        .get(`/api/v1/vacantes/${uuid()}`)
        .set(auth(reclutador))
        .expect(404);
      expect(body.codigo).toBe('NO_ENCONTRADO');
      expect(JSON.stringify(body)).not.toMatch(/vacantes\.|postgres|at \w+ \(/);
    });
  });

  describe('concurrencia', () => {
    it('publicar dos veces a la vez deja una sola publicacion', async () => {
      const id = await crearVacante();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [uuid()] })
        .expect(200);

      // La transaccion con bloqueo de fila existe para esto. Sin ella, las dos
      // peticiones leerian "borrador" a la vez y ambas escribirian la fecha de
      // publicacion.
      const respuestas = await Promise.all([
        api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)),
        api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)),
      ]);

      const codigos = respuestas.map((r) => r.status).sort();
      expect(codigos).toEqual([200, 400]);

      const [fila] = await consultar<{ estado: string }>(
        'select estado from vacantes.vacantes where id = $1',
        [id],
      );
      expect(fila.estado).toBe('publicada');
    });

    it('dos invitaciones simultaneas al mismo candidato no duplican la fila', async () => {
      const id = await crearVacante();
      await Promise.all([
        api(app)
          .post(`/api/v1/vacantes/${id}/candidatos`)
          .set(auth(reclutador))
          .send({ idCandidato: candidato.id }),
        api(app)
          .post(`/api/v1/vacantes/${id}/candidatos`)
          .set(auth(reclutador))
          .send({ idCandidato: candidato.id }),
      ]);

      // La garantia real es la restriccion unica de la base de datos: la
      // comprobacion previa del servicio la pasan las dos peticiones a la vez.
      expect(
        await consultar('select 1 from vacantes.vacante_candidatos where id_vacante = $1', [id]),
      ).toHaveLength(1);
    });

    it('dos registros simultaneos con el mismo correo dejan un solo usuario', async () => {
      const datos = {
        correo: 'carrera@ejemplo.com',
        contrasena: 'una-frase-larga-y-dificil',
        nombreCompleto: 'Carrera Simultanea',
      };
      const respuestas = await Promise.all([
        api(app).post('/api/v1/autenticacion/registro').send(datos),
        api(app).post('/api/v1/autenticacion/registro').send(datos),
      ]);

      expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await consultar('select 1 from autenticacion.usuarios where correo_hash is not null'),
      ).toHaveLength(5); // los 4 del montaje mas este
    });
  });
});
