import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import type * as ModuloEventos from '../../src/common/events/index.js';
import type * as ModuloEntregas from '../../src/modules/entregas/index.js';
import type * as ModuloEvaluacion from '../../src/modules/evaluacion/index.js';
import type { TrabajoDeEvaluacion } from '../../src/modules/evaluacion/index.js';

// Se cargan en beforeAll, despues de prepararEntorno(): importarlos arriba
// evaluaria los decoradores de limites con el process.env equivocado.
let BusDeEventos: typeof ModuloEventos.BusDeEventos;
let ENTREGA_COMPLETADA: typeof ModuloEntregas.ENTREGA_COMPLETADA;
let ColaDeEvaluacionService: typeof ModuloEvaluacion.ColaDeEvaluacionService;
let EVALUADOR: typeof ModuloEvaluacion.EVALUADOR;
let EvaluacionNoReintentableError: typeof ModuloEvaluacion.EvaluacionNoReintentableError;
let ServicioDeIaNoDisponibleError: typeof ModuloEvaluacion.ServicioDeIaNoDisponibleError;

/**
 * Sustituye al servicio de IA, que es lo unico externo.
 *
 * La cola, Redis, el worker, PostgreSQL y los cambios de estado son los reales:
 * lo que se prueba es justamente su comportamiento ante un servicio que tarda,
 * falla o responde.
 */
class EvaluadorFalso {
  llamadas: string[] = [];
  comportamiento: (t: TrabajoDeEvaluacion) => Promise<void> = () => Promise.resolve();

  evaluar(trabajo: TrabajoDeEvaluacion): Promise<void> {
    this.llamadas.push(trabajo.idEntrega);
    return this.comportamiento(trabajo);
  }
}

/**
 * Criterios de aceptacion del paquete 4.1, contra Redis, PostgreSQL y MinIO.
 *
 *  1. Una entrega encolada no bloquea la respuesta al candidato.
 *  2. Un fallo del servicio de IA no pierde el trabajo: se reintenta segun la
 *     politica definida.
 *  3. El candidato puede ver que su entrega esta en proceso de evaluacion.
 */
describe('integracion: cola de evaluacion', () => {
  let app: INestApplication<Server>;
  let colaDePrueba: Queue;
  let reclutador: Sesion;
  let candidato: Sesion;
  let administrador: Sesion;
  const falso = new EvaluadorFalso();
  let abrirPuerta: (() => void) | undefined;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  /** El servicio de IA "tarda" hasta que la prueba abre la puerta. */
  function cerrarPuerta(): void {
    const puerta = new Promise<void>((resolver) => (abrirPuerta = resolver));
    falso.comportamiento = () => puerta;
  }

  let contador = 0;
  async function entregaNueva(): Promise<{ id: string; body: Record<string, unknown> }> {
    const { body: vacante } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(reclutador))
      .send({
        titulo: 'Desarrollador backend junior',
        descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
      })
      .expect(201);
    const idEjercicio = await crearEjercicioEnElBanco(app, reclutador, `Ejercicio ${++contador}`);
    await api(app)
      .put(`/api/v1/vacantes/${vacante.id}/ejercicios`)
      .set(auth(reclutador))
      .send({ idsDeEjercicios: [idEjercicio] })
      .expect(200);
    await api(app)
      .post(`/api/v1/vacantes/${vacante.id}/publicar`)
      .set(auth(reclutador))
      .expect(200);
    await api(app)
      .post(`/api/v1/vacantes/${vacante.id}/candidatos`)
      .set(auth(reclutador))
      .send({ idCandidato: candidato.id })
      .expect(200);

    const { body } = await api(app)
      .post('/api/v1/entregas')
      .set(auth(candidato))
      .field('idVacante', vacante.id as string)
      .field('idEjercicio', idEjercicio)
      .attach('archivo', Buffer.from('print("solucion")'), 'solucion.zip')
      .expect(201);
    return { id: body.id as string, body: body as Record<string, unknown> };
  }

  async function esperarEstado(id: string, estado: string): Promise<void> {
    await vi.waitFor(
      async () => {
        const [fila] = await consultar<{ estado: string }>(
          'select estado from entregas.entregas where id = $1',
          [id],
        );
        expect(fila?.estado).toBe(estado);
      },
      { timeout: 15_000, interval: 50 },
    );
  }

  async function esperarTrabajo(id: string, estado: string): Promise<void> {
    await vi.waitFor(
      async () => {
        const trabajo = await colaDePrueba.getJob(id);
        expect(await trabajo?.getState()).toBe(estado);
      },
      { timeout: 15_000, interval: 50 },
    );
  }

  const historial = (id: string) =>
    consultar<{ desde: string | null; hacia: string; motivo: string | null }>(
      'select desde, hacia, motivo from entregas.historial_estados where id_entrega = $1 order by momento',
      [id],
    );

  beforeAll(async () => {
    await prepararEntorno();
    process.env.COLA_WORKER_HABILITADO = 'true';
    ({ BusDeEventos } = await import('../../src/common/events/index.js'));
    ({ ENTREGA_COMPLETADA } = await import('../../src/modules/entregas/index.js'));
    ({
      ColaDeEvaluacionService,
      EVALUADOR,
      EvaluacionNoReintentableError,
      ServicioDeIaNoDisponibleError,
    } = await import('../../src/modules/evaluacion/index.js'));
    const { NOMBRE_COLA_EVALUACION } = await import('../../src/modules/evaluacion/index.js');

    await migrar();
    app = await levantarAplicacion((m) => m.overrideProvider(EVALUADOR).useValue(falso));

    colaDePrueba = new Queue(NOMBRE_COLA_EVALUACION, {
      prefix: 'meritia',
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD || undefined,
        db: Number(process.env.REDIS_DB),
      },
    });
  }, 120_000);

  afterAll(async () => {
    abrirPuerta?.();
    await colaDePrueba?.close();
    await app?.close();
  });

  beforeEach(async () => {
    falso.llamadas = [];
    falso.comportamiento = () => Promise.resolve();
    await vaciarTablas();
    for (const tipo of ['completed', 'failed', 'delayed', 'wait'] as const) {
      await colaDePrueba.clean(0, 10_000, tipo);
    }
    reclutador = await crearConRol(app, 'recl@ejemplo.com', 'reclutador');
    administrador = await crearConRol(app, 'admin@ejemplo.com', 'administrador');
    candidato = await registrarCandidato(app, 'cand@ejemplo.com');
  });

  afterEach(async () => {
    // Nunca dejar un trabajo colgado: el siguiente caso vacia las tablas y
    // app.close() espera a que terminen los trabajos activos.
    abrirPuerta?.();
    abrirPuerta = undefined;
    await vi.waitFor(
      async () => {
        const c = await colaDePrueba.getJobCounts('active', 'waiting', 'delayed');
        expect(c.active + c.waiting + c.delayed).toBe(0);
      },
      { timeout: 15_000, interval: 50 },
    );
  });

  describe('CRITERIO: la entrega encolada no bloquea la respuesta al candidato', () => {
    it('la subida responde mientras el servicio de IA sigue sin contestar', async () => {
      cerrarPuerta();

      // Si la peticion esperara a la evaluacion no volveria nunca: la puerta
      // sigue cerrada hasta el final de la prueba.
      const { id, body } = await entregaNueva();
      expect(body.estado).toBe('recibida');
      expect(body.enProcesoDeEvaluacion).toBe(true);

      // Se espera a la LLAMADA, no solo al estado: el worker marca
      // `en_evaluacion` ANTES de invocar al evaluador, asi que comprobar el
      // estado y acto seguido las llamadas era una carrera que fallaba sola.
      await vi.waitFor(() => expect(falso.llamadas).toEqual([id]));
      await esperarEstado(id, 'en_evaluacion');

      abrirPuerta?.();
      await esperarEstado(id, 'evaluada');
    });
  });

  describe('CRITERIO: el candidato ve que su entrega esta en evaluacion', () => {
    it('mientras se evalua lo ve en la consulta y en su listado; al terminar, deja de estarlo', async () => {
      cerrarPuerta();
      const { id } = await entregaNueva();
      await esperarEstado(id, 'en_evaluacion');

      const { body: durante } = await api(app)
        .get(`/api/v1/entregas/${id}`)
        .set(auth(candidato))
        .expect(200);
      expect(durante.estado).toBe('en_evaluacion');
      expect(durante.enProcesoDeEvaluacion).toBe(true);
      expect(durante.historial.map((h: { hacia: string }) => h.hacia)).toEqual([
        'recibida',
        'en_evaluacion',
      ]);

      const { body: mias } = await api(app)
        .get('/api/v1/entregas/mias')
        .set(auth(candidato))
        .expect(200);
      expect(mias[0]).toMatchObject({ id, enProcesoDeEvaluacion: true });

      abrirPuerta?.();
      await esperarEstado(id, 'evaluada');

      const { body: despues } = await api(app)
        .get(`/api/v1/entregas/${id}`)
        .set(auth(candidato))
        .expect(200);
      expect(despues.enProcesoDeEvaluacion).toBe(false);
    });
  });

  describe('CRITERIO: un fallo del servicio de IA no pierde el trabajo', () => {
    it('los fallos transitorios se reintentan y la evaluacion termina', async () => {
      let fallos = 0;
      falso.comportamiento = () =>
        ++fallos <= 2
          ? Promise.reject(new ServicioDeIaNoDisponibleError('503 Service Unavailable'))
          : Promise.resolve();

      const { id } = await entregaNueva();
      await esperarEstado(id, 'evaluada');

      expect(falso.llamadas).toHaveLength(3);
      // Los reintentos no ensucian el historial: el candidato ve un solo paso
      // a evaluacion y su final.
      expect((await historial(id)).map((h) => h.hacia)).toEqual([
        'recibida',
        'en_evaluacion',
        'evaluada',
      ]);
    });

    it('agotados los reintentos, la entrega queda fallida y el trabajo se conserva', async () => {
      falso.comportamiento = () =>
        Promise.reject(new Error('connect ECONNREFUSED 10.0.0.7:8080 api-key=sk-secreto'));

      const { id } = await entregaNueva();
      await esperarEstado(id, 'fallida');
      await esperarTrabajo(id, 'failed');

      expect(falso.llamadas).toHaveLength(3); // COLA_REINTENTOS=3 en el entorno de pruebas

      // El motivo que ve el candidato no filtra el detalle tecnico del fallo.
      const ultimo = (await historial(id)).at(-1);
      expect(ultimo?.hacia).toBe('fallida');
      expect(ultimo?.motivo).toMatch(/3 intento/);
      expect(ultimo?.motivo).not.toMatch(/sk-secreto|10\.0\.0\.7|ECONNREFUSED/);

      const { body } = await api(app)
        .get(`/api/v1/entregas/${id}`)
        .set(auth(candidato))
        .expect(200);
      expect(body.estado).toBe('fallida');
      expect(body.enProcesoDeEvaluacion).toBe(false);

      const { body: metricas } = await api(app)
        .get('/api/v1/evaluaciones/cola')
        .set(auth(administrador))
        .expect(200);
      expect(metricas.fallidos).toBe(1);
    });

    it('un fallo no reintentable no gasta mas llamadas al servicio de IA', async () => {
      falso.comportamiento = () =>
        Promise.reject(new EvaluacionNoReintentableError('El archivo no se puede leer'));

      const { id } = await entregaNueva();
      await esperarEstado(id, 'fallida');
      await esperarTrabajo(id, 'failed');

      expect(falso.llamadas).toHaveLength(1);
    });

    it('un administrador reintenta una fallida y termina evaluada, sin gastar intento del candidato', async () => {
      falso.comportamiento = () => Promise.reject(new ServicioDeIaNoDisponibleError('caido'));
      const { id } = await entregaNueva();
      await esperarEstado(id, 'fallida');
      await esperarTrabajo(id, 'failed');

      falso.comportamiento = () => Promise.resolve();
      falso.llamadas = [];
      const { body } = await api(app)
        .post(`/api/v1/evaluaciones/${id}/reintentar`)
        .set(auth(administrador))
        .expect(202);
      expect(body).toEqual({ idEntrega: id, estado: 'encolada' });

      await esperarEstado(id, 'evaluada');
      expect(falso.llamadas).toEqual([id]);
      expect((await historial(id)).map((h) => [h.desde, h.hacia])).toContainEqual([
        'fallida',
        'en_evaluacion',
      ]);

      const intentos = await consultar('select 1 from entregas.entregas where id_candidato = $1', [
        candidato.id,
      ]);
      expect(intentos).toHaveLength(1);
    });

    it('reintentar solo aplica a fallidas, y solo lo hace un administrador', async () => {
      const { id } = await entregaNueva();
      await esperarEstado(id, 'evaluada');

      await api(app)
        .post(`/api/v1/evaluaciones/${id}/reintentar`)
        .set(auth(administrador))
        .expect(409);
      await api(app).post(`/api/v1/evaluaciones/${id}/reintentar`).set(auth(candidato)).expect(403);
      await api(app)
        .post(`/api/v1/evaluaciones/${id}/reintentar`)
        .set(auth(reclutador))
        .expect(403);
      await api(app)
        .post(`/api/v1/evaluaciones/${uuid()}/reintentar`)
        .set(auth(administrador))
        .expect(404);
    });

    it('una entrega cuyo evento se perdio se recupera con el barrido', async () => {
      const { id } = await entregaNueva();
      await esperarEstado(id, 'evaluada');
      await esperarTrabajo(id, 'completed');

      // Simula la caida del proceso entre el commit y el encolado: la entrega
      // quedo en `recibida` y en la cola no hay nada.
      await consultar(
        `update entregas.entregas set estado = 'recibida', creada_en = now() - interval '1 hour' where id = $1`,
        [id],
      );
      await colaDePrueba.remove(id);
      falso.llamadas = [];

      const cola = app.get(ColaDeEvaluacionService);
      expect(await cola.reencolarPendientes(60_000)).toBe(1);

      await esperarEstado(id, 'evaluada');
      expect(falso.llamadas).toEqual([id]);
    });

    it('el barrido no toca entregas recientes, que aun pueden estar llegando a la cola', async () => {
      cerrarPuerta();
      const { id } = await entregaNueva();
      await esperarEstado(id, 'en_evaluacion');

      expect(await app.get(ColaDeEvaluacionService).reencolarPendientes(60_000)).toBe(0);
      abrirPuerta?.();
      await esperarEstado(id, 'evaluada');
    });
  });

  describe('idempotencia: una entrega no se evalua dos veces', () => {
    it('encolar varias veces la misma entrega produce una sola llamada al servicio de IA', async () => {
      cerrarPuerta();
      const { id, body } = await entregaNueva();
      await esperarEstado(id, 'en_evaluacion');

      const bus = app.get(BusDeEventos);
      const evento = {
        name: ENTREGA_COMPLETADA,
        occurredAt: new Date(),
        payload: {
          idEntrega: id,
          idVacante: body.idVacante as string,
          idCandidato: candidato.id,
          idEjercicio: body.idEjercicio as string,
          numeroIntento: 1,
        },
      };
      bus.publicar(evento);
      bus.publicar(evento);
      await app.get(ColaDeEvaluacionService).encolar(id);

      abrirPuerta?.();
      await esperarEstado(id, 'evaluada');
      await new Promise((r) => setTimeout(r, 300));
      expect(falso.llamadas).toEqual([id]);
    });

    it('una entrega ya evaluada no vuelve a llamar al servicio de IA', async () => {
      const { id } = await entregaNueva();
      await esperarEstado(id, 'evaluada');
      await esperarTrabajo(id, 'completed');

      await colaDePrueba.remove(id);
      await app.get(ColaDeEvaluacionService).encolar(id);
      await esperarTrabajo(id, 'completed');

      expect(falso.llamadas).toEqual([id]);
    });
  });

  describe('seguridad de la cola', () => {
    it('por Redis solo viaja el identificador de la entrega', async () => {
      cerrarPuerta();
      const { id } = await entregaNueva();
      await esperarEstado(id, 'en_evaluacion');

      const trabajo = await colaDePrueba.getJob(id);
      expect(trabajo?.data).toEqual({ idEntrega: id });
      expect(JSON.stringify(trabajo?.data)).not.toContain('cand@ejemplo.com');
    });

    it('las metricas de la cola son solo para administradores', async () => {
      const { body } = await api(app)
        .get('/api/v1/evaluaciones/cola')
        .set(auth(administrador))
        .expect(200);
      expect(body).toEqual({
        enEspera: 0,
        activos: 0,
        reprogramados: 0,
        fallidos: 0,
        completados: 0,
        workerActivo: true,
      });

      await api(app).get('/api/v1/evaluaciones/cola').set(auth(candidato)).expect(403);
      await api(app).get('/api/v1/evaluaciones/cola').set(auth(reclutador)).expect(403);
      await api(app).get('/api/v1/evaluaciones/cola').expect(401);
    });
  });
});
