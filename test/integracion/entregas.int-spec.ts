import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import type { DomainEvent } from '../../src/common/events/index.js';
import type * as ModuloEventos from '../../src/common/events/index.js';
import type * as ModuloEntregas from '../../src/modules/entregas/index.js';
import type { EventoEntregaCompletada } from '../../src/modules/entregas/index.js';

// Los valores de estos modulos se cargan en beforeAll, DESPUES de
// prepararEntorno(). Importarlos arriba evaluaria los controladores antes de
// tiempo, y decoradores como @LimiteLogin() leerian process.env sin los limites
// de las pruebas: el registro de usuarios devolveria 429 a la decima llamada.
let BusDeEventos: typeof ModuloEventos.BusDeEventos;
let EntregasService: typeof ModuloEntregas.EntregasService;
let EstadoEntrega: typeof ModuloEntregas.EstadoEntrega;
let TransicionInvalidaError: typeof ModuloEntregas.TransicionInvalidaError;
let ENTREGA_COMPLETADA: typeof ModuloEntregas.ENTREGA_COMPLETADA;

/**
 * Criterios de aceptacion del paquete 3.4, contra PostgreSQL, Redis y MinIO.
 *
 *  1. Un candidato no puede exceder el numero de intentos permitido.
 *  2. El estado de cada intento es consultable y trazable.
 *  3. La entrega completada dispara el evento de evaluacion sin acoplamiento
 *     directo entre modulos.
 */
describe('integracion: entregas', () => {
  let app: INestApplication<Server>;
  let reclutador: Sesion;
  let otroReclutador: Sesion;
  let candidato: Sesion;
  let otroCandidato: Sesion;
  let eventos: DomainEvent<EventoEntregaCompletada>[];
  let cancelarSuscripcion: () => void;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  let contador = 0;

  /** Vacante publicada, con candidato invitado. */
  async function vacanteLista(
    intentosPermitidos = 1,
    cantidadEjercicios = 1,
  ): Promise<{ idVacante: string; ejercicios: string[] }> {
    const { body } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(reclutador))
      .send({
        titulo: 'Desarrollador backend junior',
        descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
        intentosPermitidos,
      })
      .expect(201);
    const idVacante = body.id as string;

    const ejercicios: string[] = [];
    for (let i = 0; i < cantidadEjercicios; i++) {
      ejercicios.push(await crearEjercicioEnElBanco(app, reclutador, `Ejercicio ${++contador}`));
    }
    await api(app)
      .put(`/api/v1/vacantes/${idVacante}/ejercicios`)
      .set(auth(reclutador))
      .send({ idsDeEjercicios: ejercicios })
      .expect(200);
    await api(app).post(`/api/v1/vacantes/${idVacante}/publicar`).set(auth(reclutador)).expect(200);
    await api(app)
      .post(`/api/v1/vacantes/${idVacante}/candidatos`)
      .set(auth(reclutador))
      .send({ idCandidato: candidato.id })
      .expect(200);
    return { idVacante, ejercicios };
  }

  const entregar = (
    quien: Sesion,
    idVacante: string,
    idEjercicio: string,
    nombre = 'solucion.zip',
    contenido: Buffer = Buffer.from('contenido de la solucion del candidato'),
    tipoDeclarado?: string,
  ) =>
    api(app)
      .post('/api/v1/entregas')
      .set(auth(quien))
      .field('idVacante', idVacante)
      .field('idEjercicio', idEjercicio)
      .attach(
        'archivo',
        contenido,
        tipoDeclarado ? { filename: nombre, contentType: tipoDeclarado } : nombre,
      );

  const filas = (idVacante: string) =>
    consultar<{ id: string; numero_intento: number }>(
      'select id, numero_intento from entregas.entregas where id_vacante = $1 order by numero_intento',
      [idVacante],
    );

  beforeAll(async () => {
    await prepararEntorno();
    ({ BusDeEventos } = await import('../../src/common/events/index.js'));
    ({ EntregasService, EstadoEntrega, TransicionInvalidaError, ENTREGA_COMPLETADA } =
      await import('../../src/modules/entregas/index.js'));
    await migrar();
    app = await levantarAplicacion();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await vaciarTablas();
    reclutador = await crearConRol(app, 'recl1@ejemplo.com', 'reclutador');
    otroReclutador = await crearConRol(app, 'recl2@ejemplo.com', 'reclutador', 'Empresa rival');
    candidato = await registrarCandidato(app, 'cand1@ejemplo.com');
    otroCandidato = await registrarCandidato(app, 'cand2@ejemplo.com');

    // Se escucha igual que lo hara el modulo de evaluacion: por el bus y el
    // nombre del evento, sin tocar el servicio de entregas.
    eventos = [];
    cancelarSuscripcion = app
      .get(BusDeEventos)
      .suscribir<EventoEntregaCompletada>(ENTREGA_COMPLETADA, (e) => {
        eventos.push(e);
      });
  });

  afterEach(() => {
    cancelarSuscripcion();
  });

  describe('CRITERIO: no se excede el numero de intentos permitido', () => {
    it('con un intento, el segundo se rechaza con 409 y no se guarda', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);

      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      expect(body.numeroIntento).toBe(1);

      const rechazo = await entregar(candidato, idVacante, ejercicios[0]).expect(409);
      expect(rechazo.body.mensaje).toMatch(/1 intento/);

      expect(await filas(idVacante)).toHaveLength(1);
    });

    it('con tres intentos, numera 1, 2 y 3 y rechaza el cuarto', async () => {
      const { idVacante, ejercicios } = await vacanteLista(3);

      for (const esperado of [1, 2, 3]) {
        const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);
        expect(body.numeroIntento).toBe(esperado);
      }
      await entregar(candidato, idVacante, ejercicios[0]).expect(409);

      expect((await filas(idVacante)).map((f) => f.numero_intento)).toEqual([1, 2, 3]);
    });

    it('los intentos se cuentan por ejercicio: agotar uno no bloquea el otro', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1, 2);

      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      await entregar(candidato, idVacante, ejercicios[0]).expect(409);
      await entregar(candidato, idVacante, ejercicios[1]).expect(201);
    });

    it('los intentos de un candidato no consumen los de otro', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: otroCandidato.id })
        .expect(200);

      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      await entregar(otroCandidato, idVacante, ejercicios[0]).expect(201);
    });

    it('CONCURRENCIA: diez subidas simultaneas con un intento dejan exactamente una', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          entregar(candidato, idVacante, ejercicios[0], `intento-${i}.zip`),
        ),
      );
      const codigos = respuestas.map((r) => r.status).sort();

      expect(codigos.filter((c) => c === 201)).toHaveLength(1);
      expect(codigos.filter((c) => c === 409)).toHaveLength(9);
      expect(await filas(idVacante)).toHaveLength(1);
      await vi.waitFor(() => expect(eventos).toHaveLength(1));
    });

    it('CONCURRENCIA: con tres intentos, diez simultaneas dejan tres, numeradas sin huecos', async () => {
      const { idVacante, ejercicios } = await vacanteLista(3);

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, () => entregar(candidato, idVacante, ejercicios[0])),
      );

      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(3);
      expect((await filas(idVacante)).map((f) => f.numero_intento)).toEqual([1, 2, 3]);
    });

    it('el limite se fija entre 1 y 10', async () => {
      for (const intentosPermitidos of [0, 11, 2.5]) {
        await api(app)
          .post('/api/v1/vacantes')
          .set(auth(reclutador))
          .send({
            titulo: 'Desarrollador backend junior',
            descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
            intentosPermitidos,
          })
          .expect(400);
      }
    });

    it('por omision una vacante permite un solo intento', async () => {
      const { body } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({
          titulo: 'Desarrollador backend junior',
          descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
        })
        .expect(201);
      const [fila] = await consultar<{ intentos_permitidos: number }>(
        'select intentos_permitidos from vacantes.vacantes where id = $1',
        [body.id],
      );
      expect(fila.intentos_permitidos).toBe(1);
    });

    it('con la vacante publicada el limite ya no se cambia', async () => {
      const { idVacante } = await vacanteLista(1);
      const { body } = await api(app)
        .patch(`/api/v1/vacantes/${idVacante}`)
        .set(auth(reclutador))
        .send({ intentosPermitidos: 5 })
        .expect(400);
      expect(body.mensaje).toMatch(/borrador/);
    });
  });

  describe('CRITERIO: el estado de cada intento es consultable y trazable', () => {
    it('recien entregado esta "recibida", con su primera linea de historial', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);

      const { body: consulta } = await api(app)
        .get(`/api/v1/entregas/${body.id}`)
        .set(auth(candidato))
        .expect(200);

      expect(consulta.estado).toBe('recibida');
      expect(consulta.historial).toHaveLength(1);
      expect(consulta.historial[0]).toMatchObject({ desde: null, hacia: 'recibida' });
    });

    it('cada cambio de estado queda en el historial, en orden', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      const servicio = app.get(EntregasService);

      await servicio.cambiarEstado(
        body.id as string,
        EstadoEntrega.EnEvaluacion,
        'Tomada por el evaluador',
      );
      await servicio.cambiarEstado(
        body.id as string,
        EstadoEntrega.Fallida,
        'El servicio de IA no respondio',
      );
      await servicio.cambiarEstado(body.id as string, EstadoEntrega.EnEvaluacion, 'Reintento');
      await servicio.cambiarEstado(body.id as string, EstadoEntrega.Evaluada, 'Nota calculada');

      const { body: consulta } = await api(app)
        .get(`/api/v1/entregas/${body.id}`)
        .set(auth(reclutador))
        .expect(200);

      expect(consulta.estado).toBe('evaluada');
      expect(
        (consulta.historial as { desde: string | null; hacia: string }[]).map((h) => [
          h.desde,
          h.hacia,
        ]),
      ).toEqual([
        [null, 'recibida'],
        ['recibida', 'en_evaluacion'],
        ['en_evaluacion', 'fallida'],
        ['fallida', 'en_evaluacion'],
        ['en_evaluacion', 'evaluada'],
      ]);
    });

    it('una transicion invalida se rechaza y no deja rastro', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      const servicio = app.get(EntregasService);

      await expect(
        servicio.cambiarEstado(body.id as string, EstadoEntrega.Evaluada, 'Saltando la evaluacion'),
      ).rejects.toBeInstanceOf(TransicionInvalidaError);

      const historial = await consultar(
        'select 1 from entregas.historial_estados where id_entrega = $1',
        [body.id],
      );
      expect(historial).toHaveLength(1);
    });

    it('CONCURRENCIA: dos evaluadores que toman la misma entrega a la vez, solo uno la toma', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      const servicio = app.get(EntregasService);

      const resultados = await Promise.allSettled([
        servicio.cambiarEstado(body.id as string, EstadoEntrega.EnEvaluacion, 'Evaluador A'),
        servicio.cambiarEstado(body.id as string, EstadoEntrega.EnEvaluacion, 'Evaluador B'),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const historial = await consultar(
        'select 1 from entregas.historial_estados where id_entrega = $1',
        [body.id],
      );
      expect(historial).toHaveLength(2);
    });

    it('el candidato lista sus intentos, y filtra por vacante', async () => {
      const a = await vacanteLista(2);
      const b = await vacanteLista(1);
      await entregar(candidato, a.idVacante, a.ejercicios[0]).expect(201);
      await entregar(candidato, a.idVacante, a.ejercicios[0]).expect(201);
      await entregar(candidato, b.idVacante, b.ejercicios[0]).expect(201);

      const { body: todas } = await api(app)
        .get('/api/v1/entregas/mias')
        .set(auth(candidato))
        .expect(200);
      expect(todas).toHaveLength(3);

      const { body: deA } = await api(app)
        .get(`/api/v1/entregas/mias?idVacante=${a.idVacante}`)
        .set(auth(candidato))
        .expect(200);
      expect(deA).toHaveLength(2);

      const { body: ajenas } = await api(app)
        .get('/api/v1/entregas/mias')
        .set(auth(otroCandidato))
        .expect(200);
      expect(ajenas).toHaveLength(0);
    });

    it('el reclutador de la vacante ve sus entregas', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);

      const { body } = await api(app)
        .get(`/api/v1/entregas/vacante/${idVacante}`)
        .set(auth(reclutador))
        .expect(200);
      expect(body).toHaveLength(1);
      expect(body[0].idCandidato).toBe(candidato.id);
    });
  });

  describe('CRITERIO: la entrega dispara el evento de evaluacion sin acoplamiento', () => {
    it('publica un evento con los identificadores, una sola vez', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);

      await vi.waitFor(() => expect(eventos).toHaveLength(1));
      expect(eventos[0].payload).toEqual({
        idEntrega: body.id,
        idVacante,
        idCandidato: candidato.id,
        idEjercicio: ejercicios[0],
        numeroIntento: 1,
      });
    });

    it('cuando el suscriptor lo recibe, la entrega ya esta guardada', async () => {
      // Si se publicara antes del commit, evaluacion buscaria una fila que aun no existe.
      const vistas: number[] = [];
      const cancelar = app
        .get(BusDeEventos)
        .suscribir<EventoEntregaCompletada>(ENTREGA_COMPLETADA, async (e) => {
          const filas = await consultar('select 1 from entregas.entregas where id = $1', [
            e.payload.idEntrega,
          ]);
          vistas.push(filas.length);
        });

      const { idVacante, ejercicios } = await vacanteLista(1);
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);

      await vi.waitFor(() => expect(vistas).toEqual([1]));
      cancelar();
    });

    it('una entrega rechazada no publica nada', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      await vi.waitFor(() => expect(eventos).toHaveLength(1));

      await entregar(candidato, idVacante, ejercicios[0]).expect(409);
      await entregar(candidato, idVacante, ejercicios[0], 'virus.exe').expect(400);
      await entregar(otroCandidato, idVacante, ejercicios[0]).expect(404);

      // Da tiempo a que llegara un evento que no deberia existir.
      await new Promise((r) => setTimeout(r, 100));
      expect(eventos).toHaveLength(1);
    });
  });

  describe('acceso por recurso: cambiar un identificador no da acceso', () => {
    it('un candidato no invitado recibe 404 al entregar, no 403', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await entregar(otroCandidato, idVacante, ejercicios[0]).expect(404);
    });

    it('no se entrega en una vacante en borrador, aunque el candidato este invitado', async () => {
      const { body } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({
          titulo: 'Desarrollador backend junior',
          descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
        })
        .expect(201);
      const idEjercicio = await crearEjercicioEnElBanco(app, reclutador, 'Ejercicio borrador');
      await api(app)
        .post(`/api/v1/vacantes/${body.id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id });

      await entregar(candidato, body.id as string, idEjercicio).expect(404);
    });

    it('no se entrega en una vacante cerrada', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await api(app).post(`/api/v1/vacantes/${idVacante}/cerrar`).set(auth(reclutador)).expect(200);
      await entregar(candidato, idVacante, ejercicios[0]).expect(404);
    });

    it('un ejercicio que no es de la vacante se rechaza', async () => {
      const { idVacante } = await vacanteLista(1);
      const ajeno = await crearEjercicioEnElBanco(app, reclutador, 'Ejercicio de otra vacante');
      await entregar(candidato, idVacante, ajeno).expect(400);
    });

    it('otro candidato y otro reclutador no ven la entrega ni su descarga', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);

      for (const intruso of [otroCandidato, otroReclutador]) {
        await api(app).get(`/api/v1/entregas/${body.id}`).set(auth(intruso)).expect(404);
        await api(app).get(`/api/v1/entregas/${body.id}/descarga`).set(auth(intruso)).expect(404);
      }
      await api(app)
        .get(`/api/v1/entregas/vacante/${idVacante}`)
        .set(auth(otroReclutador))
        .expect(404);
    });

    it('un reclutador no entrega, y un candidato no lista las entregas de una vacante', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await entregar(reclutador, idVacante, ejercicios[0]).expect(403);
      await api(app).get(`/api/v1/entregas/vacante/${idVacante}`).set(auth(candidato)).expect(403);
    });

    it('sin sesion no hay nada', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await api(app)
        .post('/api/v1/entregas')
        .field('idVacante', idVacante)
        .field('idEjercicio', ejercicios[0])
        .attach('archivo', Buffer.from('x'), 'solucion.zip')
        .expect(401);
      await api(app).get('/api/v1/entregas/mias').expect(401);
    });
  });

  describe('el archivo', () => {
    it('se descarga por un enlace temporal y llega intacto', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const contenido = Buffer.from('%PDF-1.4 informe del candidato');
      const { body } = await entregar(
        candidato,
        idVacante,
        ejercicios[0],
        'informe.pdf',
        contenido,
      ).expect(201);

      for (const quien of [candidato, reclutador]) {
        const { body: enlace } = await api(app)
          .get(`/api/v1/entregas/${body.id}/descarga`)
          .set(auth(quien))
          .expect(200);
        expect(enlace.expiraEnSegundos).toBe(300);

        const respuesta = await fetch(enlace.url as string);
        expect(respuesta.status).toBe(200);
        expect(Buffer.from(await respuesta.arrayBuffer()).equals(contenido)).toBe(true);
      }
    });

    it('la respuesta no expone la clave interna del objeto', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      expect(body).not.toHaveProperty('archivoClave');
      expect(JSON.stringify(body)).not.toMatch(/entregas\//);
    });

    it('el tipo de contenido sale de la extension, no del que declara el cliente', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(
        candidato,
        idVacante,
        ejercicios[0],
        'informe.pdf',
        Buffer.from('<script>alert(1)</script>'),
        'text/html',
      ).expect(201);

      const [fila] = await consultar<{ archivo_tipo: string }>(
        'select archivo_tipo from entregas.entregas where id = $1',
        [body.id],
      );
      expect(fila.archivo_tipo).toBe('application/pdf');
    });

    it('el nombre original se guarda cifrado', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      const { body } = await entregar(
        candidato,
        idVacante,
        ejercicios[0],
        'Juana Perez - cedula 123.zip',
      ).expect(201);
      expect(body.archivoNombre).toBe('Juana Perez - cedula 123.zip');

      const [fila] = await consultar<{ archivo_nombre: string }>(
        'select archivo_nombre from entregas.entregas where id = $1',
        [body.id],
      );
      expect(fila.archivo_nombre).not.toContain('Juana');
    });

    it('rechaza extensiones fuera de la lista y no consume el intento', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await entregar(candidato, idVacante, ejercicios[0], 'virus.exe').expect(400);
      await entregar(candidato, idVacante, ejercicios[0], 'sin-extension').expect(400);
      expect(await filas(idVacante)).toHaveLength(0);

      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
    });

    it('rechaza una entrega sin archivo', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await api(app)
        .post('/api/v1/entregas')
        .set(auth(candidato))
        .field('idVacante', idVacante)
        .field('idEjercicio', ejercicios[0])
        .expect(400);
    });

    it('rechaza un archivo de mas de 25 MiB con 413 y no consume el intento', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await entregar(
        candidato,
        idVacante,
        ejercicios[0],
        'enorme.zip',
        Buffer.alloc(25 * 1024 * 1024 + 1),
      ).expect(413);
      expect(await filas(idVacante)).toHaveLength(0);
    });

    it('rechaza campos que no son UUID', async () => {
      const { ejercicios } = await vacanteLista(1);
      await entregar(candidato, 'no-es-uuid', ejercicios[0]).expect(400);
    });
  });

  /**
   * El permiso de calificacion por IA, que es el unico que el backend hace
   * cumplir (D-17, contradiccion §6.10 de la matriz de pantallas).
   *
   * Lo que se fija aqui no es que un 403 salga: es la consecuencia que el
   * equipo acepto al decidir que ese permiso SI es revocable. Quien lo apaga
   * deja de poder entregar, y quien lo vuelve a conceder puede seguir.
   */
  describe('CRITERIO: sin consentimiento de calificacion por IA no se acepta la entrega', () => {
    const RUTA_PERMISOS = '/api/v1/autenticacion/consentimientos';

    const decidir = (quien: Sesion, concedido: boolean) =>
      api(app)
        .put(RUTA_PERMISOS)
        .set(auth(quien))
        .send({ decisiones: [{ tipo: 'calificacion_ia', concedido }] })
        .expect(200);

    it('quien nunca decidio puede entregar: el permiso nace concedido', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);

      // Si el valor por omision fuera false, el dia que esto se desplegara
      // dejaria de poder entregar todo el mundo a la vez.
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
    });

    it('revocarlo bloquea la entrega con 403 y dice como volver atras', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await decidir(candidato, false);

      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(403);

      // 403 y no 404: el candidato SI tiene acceso a esta vacante, lo que pasa
      // es que tomo una decision sobre sus datos. Esconderselo detras de un
      // "no existe" seria mentirle sobre algo que el mismo eligio.
      expect(body.mensaje).toMatch(/calificacion por IA/i);
      expect(body.mensaje).toMatch(/privacidad/i);
    });

    it('volver a concederlo deja entregar otra vez', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);

      await decidir(candidato, false);
      await entregar(candidato, idVacante, ejercicios[0]).expect(403);

      await decidir(candidato, true);
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
    });

    it('la entrega bloqueada no deja rastro: ni fila ni archivo', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await decidir(candidato, false);

      await entregar(candidato, idVacante, ejercicios[0]).expect(403);

      // Se comprueba ANTES de subir nada, para no dejar en el bucket un archivo
      // que nadie va a poder evaluar y que contiene datos del candidato.
      const filas = await consultar<{ total: string }>(
        `select count(*)::int as total from entregas.entregas where id_candidato = $1`,
        [candidato.id],
      );
      expect(Number(filas[0].total)).toBe(0);
    });

    it('revocar no gasta un intento', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);

      await decidir(candidato, false);
      await entregar(candidato, idVacante, ejercicios[0]).expect(403);
      await decidir(candidato, true);

      // La vacante permite un intento. Si el rechazo lo hubiera consumido,
      // este 201 seria un 409.
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
    });

    it('el bloqueo es de quien revoco, no de la vacante', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: otroCandidato.id })
        .expect(200);
      await decidir(candidato, false);

      await entregar(candidato, idVacante, ejercicios[0]).expect(403);
      // El otro esta invitado a la MISMA vacante y no decidio nada.
      await entregar(otroCandidato, idVacante, ejercicios[0]).expect(201);
    });

    it('revocar OTRO permiso no bloquea nada', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await api(app)
        .put(RUTA_PERMISOS)
        .set(auth(candidato))
        .send({
          decisiones: [
            { tipo: 'biometria', concedido: false },
            { tipo: 'perfil_publico', concedido: false },
          ],
        })
        .expect(200);

      // Las otras dos finalidades estan en `vigilado: false` y tienen que
      // seguir sin efecto: inventarles uno seria inventar producto.
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
    });

    it('revocar DESPUES de entregar no deshace la entrega', async () => {
      const { idVacante, ejercicios } = await vacanteLista(1);
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);

      await decidir(candidato, false);

      // Limite conocido y escrito en la D-17: la revocacion mira hacia
      // adelante, y ese entregable se envio bajo un consentimiento que en su
      // momento era valido.
      const filas = await consultar<{ total: string }>(
        `select count(*)::int as total from entregas.entregas where id_candidato = $1`,
        [candidato.id],
      );
      expect(Number(filas[0].total)).toBe(1);
    });

    it('quien no esta invitado sigue viendo 404 y no el 403 del permiso', async () => {
      // `vacanteLista` solo invita a `candidato`, asi que el otro es un
      // desconocido para esta vacante. Y ademas revoco el permiso.
      const { idVacante, ejercicios } = await vacanteLista(1);
      await decidir(otroCandidato, false);

      // El orden importa: si la comprobacion del permiso fuera primero, este
      // 403 le contaria a alguien sin acceso que la vacante existe.
      await entregar(otroCandidato, idVacante, ejercicios[0]).expect(404);
    });
  });

  describe('dataset adjunto al enunciado (B17)', () => {
    it('la empresa lo sube, el candidato invitado lo ve y lo descarga, y nadie mas', async () => {
      const { idVacante, ejercicios } = await vacanteLista();
      const idEjercicio = ejercicios[0];
      await api(app)
        .post(`/api/v1/ejercicios/${idEjercicio}/adjuntos`)
        .set(auth(reclutador))
        .attach('archivo', Buffer.from('id,valor\n1,10\n'), 'datos.csv')
        .expect(201);

      const { body: lista } = await api(app)
        .get(`/api/v1/vacantes/${idVacante}/ejercicios`)
        .set(auth(candidato))
        .expect(200);
      expect(lista[0].adjuntos).toHaveLength(1);
      expect(lista[0].adjuntos[0]).toMatchObject({ nombre: 'datos.csv', bytes: 14 });

      const idAdjunto = lista[0].adjuntos[0].id as string;
      const ruta = `/api/v1/vacantes/${idVacante}/ejercicios/${idEjercicio}/adjuntos/${idAdjunto}`;
      const { body: enlace } = await api(app).get(ruta).set(auth(candidato)).expect(200);
      expect(enlace.url).toMatch(/^http/);
      await api(app).get(ruta).set(auth(otroCandidato)).expect(404);
      await api(app).get(ruta).set(auth(otroReclutador)).expect(404);
    });

    it('otra empresa no adjunta a un ejercicio ajeno, y un ejecutable no entra', async () => {
      const { ejercicios } = await vacanteLista();
      await api(app)
        .post(`/api/v1/ejercicios/${ejercicios[0]}/adjuntos`)
        .set(auth(otroReclutador))
        .attach('archivo', Buffer.from('x'), 'datos.csv')
        .expect(404);
      await api(app)
        .post(`/api/v1/ejercicios/${ejercicios[0]}/adjuntos`)
        .set(auth(reclutador))
        .attach('archivo', Buffer.from('MZ'), 'virus.exe')
        .expect(400);
    });

    it('hasta cinco por version', async () => {
      const { ejercicios } = await vacanteLista();
      for (let i = 0; i < 5; i++) {
        await api(app)
          .post(`/api/v1/ejercicios/${ejercicios[0]}/adjuntos`)
          .set(auth(reclutador))
          .attach('archivo', Buffer.from(`d${i}`), `d${i}.csv`)
          .expect(201);
      }
      await api(app)
        .post(`/api/v1/ejercicios/${ejercicios[0]}/adjuntos`)
        .set(auth(reclutador))
        .attach('archivo', Buffer.from('mas'), 'mas.csv')
        .expect(400);
    });
  });

  describe('sesion cronometrada: el reloj es del servidor', () => {
    async function vacanteCronometrada(
      minutos: number,
    ): Promise<{ idVacante: string; idEjercicio: string }> {
      const { body: ej } = await api(app)
        .post('/api/v1/ejercicios')
        .set(auth(reclutador))
        .send({
          titulo: `Con reloj ${++contador}`,
          duracionMinutos: minutos,
          enunciado: 'Enunciado de prueba suficientemente largo para pasar la validacion del DTO.',
          criterios: [
            {
              nombre: 'Correccion',
              descripcion: 'Resuelve los casos del enunciado, incluidos los limite.',
              peso: 100,
              escalaMaxima: 5,
            },
          ],
        })
        .expect(201);
      const { body: v } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Backend con reloj', descripcion: 'Buscamos una persona para plataforma.' })
        .expect(201);
      await api(app)
        .put(`/api/v1/vacantes/${v.id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [ej.id] })
        .expect(200);
      await api(app).post(`/api/v1/vacantes/${v.id}/publicar`).set(auth(reclutador)).expect(200);
      await api(app)
        .post(`/api/v1/vacantes/${v.id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);
      return { idVacante: v.id as string, idEjercicio: ej.id as string };
    }
    const sesion = (quien: Sesion, ids: { idVacante: string; idEjercicio: string }) =>
      api(app).post('/api/v1/entregas/sesion').set(auth(quien)).send(ids);

    it('sin iniciar no se entrega; al iniciar corre el reloj y se puede entregar', async () => {
      const ids = await vacanteCronometrada(30);
      await entregar(candidato, ids.idVacante, ids.idEjercicio).expect(403);

      const { body } = await sesion(candidato, ids).expect(200);
      expect(body.duracionMinutos).toBe(30);
      expect(body.restanteSegundos).toBeGreaterThan(29 * 60);
      await entregar(candidato, ids.idVacante, ids.idEjercicio).expect(201);
    });

    it('iniciar dos veces devuelve la misma sesion: no da otra ventana', async () => {
      const ids = await vacanteCronometrada(30);
      const { body: a } = await sesion(candidato, ids).expect(200);
      const { body: b } = await sesion(candidato, ids).expect(200);
      expect(b.venceEn).toBe(a.venceEn);
    });

    it('vencida la sesion, mas alla de la gracia de subida, la entrega se rechaza', async () => {
      const ids = await vacanteCronometrada(30);
      await sesion(candidato, ids).expect(200);
      await consultar(
        `update entregas.sesiones set vence_en = now() - interval '5 minutes' where id_vacante = $1`,
        [ids.idVacante],
      );
      const { body } = await entregar(candidato, ids.idVacante, ids.idEjercicio).expect(403);
      expect(JSON.stringify(body)).toMatch(/tiempo/i);
      const { body: estado } = await api(app)
        .get('/api/v1/entregas/sesion')
        .query(ids)
        .set(auth(candidato))
        .expect(200);
      expect(estado.restanteSegundos).toBe(0);
    });

    it('un ejercicio sin limite no se inicia, y se entrega como siempre', async () => {
      const { idVacante, ejercicios } = await vacanteLista();
      await sesion(candidato, { idVacante, idEjercicio: ejercicios[0] }).expect(400);
      await entregar(candidato, idVacante, ejercicios[0]).expect(201);
    });

    it('quien no esta invitado no inicia nada', async () => {
      const ids = await vacanteCronometrada(30);
      await sesion(otroCandidato, ids).expect(404);
    });
  });

  describe('verificacion de la entrega: camara o modalidad alterna', () => {
    const JPEG = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('fotodeprueba'),
    ]);

    async function unaEntrega(): Promise<string> {
      const { idVacante, ejercicios } = await vacanteLista();
      const { body } = await entregar(candidato, idVacante, ejercicios[0]).expect(201);
      return body.id as string;
    }
    const verificar = (quien: Sesion, id: string, modalidad: string, foto?: Buffer) => {
      const peticion = api(app)
        .post(`/api/v1/entregas/${id}/verificacion`)
        .set(auth(quien))
        .field('modalidad', modalidad);
      return foto ? peticion.attach('foto', foto, 'cara.jpg') : peticion;
    };

    it('con camara guarda la foto 90 dias, y la empresa y el candidato ven el estado', async () => {
      const id = await unaEntrega();
      const { body } = await verificar(candidato, id, 'camara', JPEG).expect(201);
      expect(body.modalidad).toBe('camara');
      expect(body.enlace).toMatch(/^http/);
      const dias =
        (new Date(body.conservarHasta).getTime() - new Date(body.creadaEn).getTime()) / 86_400_000;
      expect(Math.round(dias)).toBe(90);

      const { body: paraLaEmpresa } = await api(app)
        .get(`/api/v1/entregas/${id}/verificacion`)
        .set(auth(reclutador))
        .expect(200);
      expect(paraLaEmpresa.modalidad).toBe('camara');
    });

    it('una vez por entrega, y solo imagenes reales', async () => {
      const id = await unaEntrega();
      await verificar(candidato, id, 'camara', Buffer.from('esto no es una imagen')).expect(400);
      await verificar(candidato, id, 'camara', JPEG).expect(201);
      await verificar(candidato, id, 'alterna').expect(409);
    });

    it('sin el permiso biometrico la camara da 403 y la alterna funciona', async () => {
      await api(app)
        .put('/api/v1/autenticacion/consentimientos')
        .set(auth(candidato))
        .send({ decisiones: [{ tipo: 'biometria', concedido: false }], origen: 'perfil' })
        .expect(200);
      const id = await unaEntrega();
      await verificar(candidato, id, 'camara', JPEG).expect(403);
      const { body } = await verificar(candidato, id, 'alterna').expect(201);
      expect(body).toMatchObject({ modalidad: 'alterna', enlace: null });
    });

    it('nadie mas verifica ni ve una entrega ajena', async () => {
      const id = await unaEntrega();
      await verificar(otroCandidato, id, 'alterna').expect(404);
      await api(app)
        .get(`/api/v1/entregas/${id}/verificacion`)
        .set(auth(otroCandidato))
        .expect(404);
      await api(app)
        .get(`/api/v1/entregas/${id}/verificacion`)
        .set(auth(otroReclutador))
        .expect(404);
      await verificar(reclutador, id, 'alterna').expect(403);
    });

    it('pasados los 90 dias la foto se borra y queda el registro', async () => {
      const id = await unaEntrega();
      await verificar(candidato, id, 'camara', JPEG).expect(201);
      const { VerificacionesService } =
        await import('../../src/modules/entregas/verificaciones.service.js');
      const servicio = app.get(VerificacionesService);
      expect(await servicio.purgarVencidas()).toBe(0);
      expect(await servicio.purgarVencidas(new Date(Date.now() + 91 * 86_400_000))).toBe(1);

      const { body } = await api(app)
        .get(`/api/v1/entregas/${id}/verificacion`)
        .set(auth(candidato))
        .expect(200);
      expect(body).toMatchObject({ modalidad: 'camara', enlace: null });
      const [fila] = await consultar<{ clave: string | null; purgada_en: Date | null }>(
        'select clave, purgada_en from entregas.verificaciones where id_entrega = $1',
        [id],
      );
      expect(fila.clave).toBeNull();
      expect(fila.purgada_en).not.toBeNull();
    });
  });
});
