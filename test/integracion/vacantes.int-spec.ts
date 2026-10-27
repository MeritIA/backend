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

/** Criterios de aceptacion del paquete 2.2, automatizados. */
describe('integracion: vacantes', () => {
  let app: INestApplication<Server>;
  let reclutador: Sesion;
  let otroReclutador: Sesion;
  let candidato: Sesion;
  let otroCandidato: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  let contadorEjercicios = 0;
  const ejercicio = () =>
    crearEjercicioEnElBanco(app, reclutador, `Ejercicio ${++contadorEjercicios}`);

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
    // En OTRA empresa: la frontera de los datos es la empresa, no la persona.
    otroReclutador = await crearConRol(app, 'recl2@ejemplo.com', 'reclutador', 'Empresa rival');
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
        .send({ idsDeEjercicios: [await ejercicio(), await ejercicio()] })
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
      const e1 = await ejercicio();
      const e2 = await ejercicio();
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
      const e = await ejercicio();
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
        .send({ idsDeEjercicios: [await ejercicio()] })
        .expect(200);
      await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(200);

      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [await ejercicio()] })
        .expect(400);
    });
  });

  describe('CRITERIO: el candidato solo consulta las vacantes asignadas', () => {
    async function vacantePublicada(): Promise<string> {
      const id = await crearVacante();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [await ejercicio()] })
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

  describe('CRITERIO: el candidato invitado puede leer el reto que se le pide', () => {
    async function publicadaCon(...idsDeEjercicios: string[]): Promise<string> {
      const id = await crearVacante();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios })
        .expect(200);
      await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(200);
      return id;
    }

    async function invitar(idVacante: string, quien = candidato): Promise<void> {
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: quien.id })
        .expect(200);
    }

    it('devuelve el enunciado y la rubrica con sus pesos', async () => {
      // Sin esto se invitaba a resolver un ejercicio ilegible: el candidato
      // podia entregar un archivo sin saber que se le pedia ni como se le
      // calificaba. La rubrica es publica a proposito (mockup B14).
      const id = await publicadaCon(await ejercicio());
      await invitar(id);

      const { body } = await api(app)
        .get(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(candidato))
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].enunciado).toContain('Enunciado de prueba');
      expect(body[0].numero).toBe(1);
      expect(body[0].criterios).toEqual([
        {
          nombre: 'Correccion funcional',
          descripcion: 'La solucion resuelve todos los casos del enunciado, incluidos los limite.',
          peso: 100,
          escalaMaxima: 5,
        },
      ]);
    });

    it('respeta el orden en que se asociaron', async () => {
      // El enunciado puede venir por partes: leerlas desordenadas cambia el
      // ejercicio.
      const primero = await ejercicio();
      const segundo = await ejercicio();
      const id = await publicadaCon(primero, segundo);
      await invitar(id);

      const { body } = await api(app)
        .get(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(candidato))
        .expect(200);

      expect(body.map((e: { idEjercicio: string }) => e.idEjercicio)).toEqual([primero, segundo]);
    });

    it('el permiso viene de la vacante, no del banco: el candidato sigue sin ver el banco', async () => {
      const idEjercicio = await ejercicio();
      const id = await publicadaCon(idEjercicio);
      await invitar(id);

      await api(app).get(`/api/v1/vacantes/${id}/ejercicios`).set(auth(candidato)).expect(200);

      // El mismo ejercicio, pedido por la puerta del banco, le sigue negado.
      await api(app).get('/api/v1/ejercicios').set(auth(candidato)).expect(403);
      await api(app).get(`/api/v1/ejercicios/${idEjercicio}`).set(auth(candidato)).expect(403);
    });

    it('sin invitacion no lo lee, y recibe el mismo 404 que la vacante', async () => {
      const id = await publicadaCon(await ejercicio());
      await invitar(id);

      await api(app).get(`/api/v1/vacantes/${id}/ejercicios`).set(auth(otroCandidato)).expect(404);
    });

    it('invitado a un borrador tampoco lo lee: el reto no esta publicado', async () => {
      const id = await crearVacante();
      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [await ejercicio()] })
        .expect(200);
      await invitar(id);

      await api(app).get(`/api/v1/vacantes/${id}/ejercicios`).set(auth(candidato)).expect(404);
    });

    it('un reclutador de otra empresa no lo lee', async () => {
      const id = await publicadaCon(await ejercicio());

      await api(app).get(`/api/v1/vacantes/${id}/ejercicios`).set(auth(otroReclutador)).expect(404);
    });

    it('el reclutador dueno lo lee: es lo que vera el candidato', async () => {
      const id = await publicadaCon(await ejercicio());

      const { body } = await api(app)
        .get(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toHaveLength(1);
    });

    it('una vacante sin ejercicios devuelve una lista vacia, no un error', async () => {
      const id = await crearVacante();

      const { body } = await api(app)
        .get(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toEqual([]);
    });

    it('muestra la version vigente, la misma contra la que se califica', async () => {
      const idEjercicio = await ejercicio();
      const id = await publicadaCon(idEjercicio);
      await invitar(id);

      await api(app)
        .post(`/api/v1/ejercicios/${idEjercicio}/versiones`)
        .set(auth(reclutador))
        .send({
          enunciado:
            'Enunciado corregido: se aclara el caso limite de la lista vacia por completo.',
          criterios: [
            {
              nombre: 'Correccion funcional',
              descripcion: 'La solucion resuelve todos los casos, incluidos los limite.',
              peso: 100,
              escalaMaxima: 5,
            },
          ],
          motivoDelCambio: 'El caso limite confundia a los candidatos.',
        })
        .expect(201);

      const { body } = await api(app)
        .get(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(candidato))
        .expect(200);

      expect(body[0].numero).toBe(2);
      expect(body[0].enunciado).toContain('Enunciado corregido');
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
        .send({ idsDeEjercicios: [await ejercicio()] })
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

    it('el listado de un reclutador no incluye las de otra empresa', async () => {
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
        .send({ idsDeEjercicios: [await ejercicio()] })
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

  describe('CRITERIO: la contratacion se registra, y dice quien y cuando (A08)', () => {
    let idVacante: string;

    const contratar = (quien: Sesion, aQuien: Sesion, vacante = idVacante) =>
      api(app)
        .post(`/api/v1/vacantes/${vacante}/candidatos/${aQuien.id}/contratar`)
        .set(auth(quien));

    const fechaDeContratacion = async (aQuien: Sesion) => {
      const [fila] = await consultar<{
        contratado_en: Date | null;
        id_usuario_que_contrato: string | null;
      }>(
        `select contratado_en, id_usuario_que_contrato
           from vacantes.vacante_candidatos
          where id_vacante = $1 and id_candidato = $2`,
        [idVacante, aQuien.id],
      );
      return fila;
    };

    beforeEach(async () => {
      const idEjercicio = await crearEjercicioEnElBanco(app, reclutador, `Reto ${uuid()}`);
      idVacante = await crearVacante();
      await api(app)
        .put(`/api/v1/vacantes/${idVacante}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [idEjercicio] })
        .expect(200);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/publicar`)
        .set(auth(reclutador))
        .expect(200);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);
    });

    it('el reclutador dueno lo marca, y queda quien lo registro', async () => {
      await contratar(reclutador, candidato).expect(200);

      const fila = await fechaDeContratacion(candidato);
      expect(fila.contratado_en).not.toBeNull();
      // Quien: contratar es la decision con consecuencias economicas del
      // proceso, y tiene que dejar rastro igual que revelar una identidad.
      expect(fila.id_usuario_que_contrato).toBe(reclutador.id);
    });

    it('volver a marcarlo no mueve la fecha: la primera es la que se audita', async () => {
      await contratar(reclutador, candidato).expect(200);
      const primera = await fechaDeContratacion(candidato);

      await contratar(reclutador, candidato).expect(200);
      const segunda = await fechaDeContratacion(candidato);

      expect(segunda.contratado_en).toEqual(primera.contratado_en);
    });

    it('se puede contratar con la vacante ya cerrada, que es el caso normal', async () => {
      // En A08 se cierra el proceso y la contratacion se confirma despues.
      await api(app).post(`/api/v1/vacantes/${idVacante}/cerrar`).set(auth(reclutador)).expect(200);

      await contratar(reclutador, candidato).expect(200);
      expect((await fechaDeContratacion(candidato)).contratado_en).not.toBeNull();
    });

    it('en un borrador no se contrata: alli no se recibe ninguna entrega', async () => {
      const borrador = await crearVacante();
      await api(app)
        .post(`/api/v1/vacantes/${borrador}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);

      const { body } = await contratar(reclutador, candidato, borrador).expect(400);
      expect(body.mensaje).toMatch(/borrador/i);
    });

    it('a quien no fue invitado, 404, y el mismo mensaje que si no existiera', async () => {
      await contratar(reclutador, otroCandidato).expect(404);
      await contratar(reclutador, candidato, uuid()).expect(404);
    });

    it('un reclutador de otra empresa no contrata en una vacante ajena', async () => {
      // 404 y no 403: con un 403 podria inventariar las vacantes de la
      // competencia probando identificadores.
      await contratar(otroReclutador, candidato).expect(404);
      expect((await fechaDeContratacion(candidato)).contratado_en).toBeNull();
    });

    it('el candidato no se contrata a si mismo', async () => {
      await contratar(candidato, candidato).expect(403);
      expect((await fechaDeContratacion(candidato)).contratado_en).toBeNull();
    });
  });
});
