import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, UnrecoverableError, Worker, type Job, type RedisOptions } from 'bullmq';
import { BusDeEventos } from '../../../common/events/index.js';
import { SaludService } from '../../../common/salud/index.js';
import {
  ENTREGA_COMPLETADA,
  EntregasService,
  EstadoEntrega,
  TransicionInvalidaError,
  type EventoEntregaCompletada,
} from '../../entregas/index.js';
import {
  EVALUADOR,
  EvaluacionNoReintentableError,
  type Evaluador,
  type TrabajoDeEvaluacion,
} from './evaluador.js';
import { conTiempoLimite } from './con-tiempo-limite.js';
import {
  NOMBRE_COLA_EVALUACION,
  NOMBRE_TRABAJO_EVALUACION,
  leerPoliticaDeCola,
  opcionesDeTrabajo,
  type PoliticaDeCola,
} from './politica-de-cola.js';

/**
 * Lo unico que viaja por Redis: el identificador de la entrega.
 *
 * Ni nombres, ni correos, ni el archivo. Redis no cifra en reposo y quien lea
 * la cola solo vera UUID; el resto se consulta en PostgreSQL al procesar.
 */
export interface DatosDelTrabajo {
  readonly idEntrega: string;
}

export interface MetricasDeCola {
  readonly enEspera: number;
  readonly activos: number;
  readonly reprogramados: number;
  readonly fallidos: number;
  readonly completados: number;
  readonly workerActivo: boolean;
}

/**
 * Cola de evaluacion, paquete 4.1.
 *
 * Criterios de aceptacion:
 *  1. Una entrega encolada no bloquea la respuesta al candidato.
 *  2. Un fallo del servicio de IA no pierde el trabajo: se reintenta segun la
 *     politica definida.
 *  3. El candidato puede ver que su entrega esta en proceso de evaluacion.
 *
 * COMO NO SE PIERDE UN TRABAJO
 *
 *  - Redis con AOF (compose.yaml): la cola sobrevive a un reinicio de Redis.
 *  - Reintentos con backoff exponencial ante fallos transitorios.
 *  - Si un worker muere a mitad de un trabajo, BullMQ detecta el bloqueo
 *    vencido y lo devuelve a la cola (trabajo "stalled").
 *  - El evento que dispara el encolado viaja en memoria; si el proceso cae
 *    entre el commit de la entrega y el encolado, un barrido periodico
 *    encuentra las entregas `recibida` antiguas y las vuelve a encolar.
 *  - Los que agotan los intentos no se borran: quedan como trabajos fallidos
 *    durante 30 dias, con la entrega en `fallida`, y un administrador los
 *    reintenta.
 *
 * POR QUE NO SE EVALUA DOS VECES
 *
 * El identificador del trabajo es el de la entrega: encolar dos veces la misma
 * es un no-op en BullMQ. Y procesar una entrega ya `evaluada` termina sin
 * llamar al servicio de IA, que es lo que cuesta dinero.
 */
@Injectable()
export class ColaDeEvaluacionService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('ColaEvaluacion');
  private readonly politica: PoliticaDeCola = leerPoliticaDeCola();
  private cola!: Queue<DatosDelTrabajo>;
  private worker?: Worker<DatosDelTrabajo>;
  private cancelarSuscripcion?: () => void;
  private barrido?: NodeJS.Timeout;

  constructor(
    private readonly entregas: EntregasService,
    private readonly bus: BusDeEventos,
    @Inject(EVALUADOR) private readonly evaluador: Evaluador,
    private readonly salud: SaludService,
  ) {}

  onModuleInit(): void {
    // Paquete 5.5: el estado de la cola es una de las cuatro dependencias
    // que el criterio exige comprobar. Contar trabajos toca Redis, asi que
    // esta comprobacion cubre las dos cosas a la vez.
    this.salud.registrar('cola', true, async () => {
      const m = await this.metricas();
      // Una cola que crece sin que nadie la consuma no esta caida, pero
      // tampoco esta bien: avisa antes de que se note en los candidatos.
      const atascada = !m.workerActivo && m.enEspera > 0;
      return atascada
        ? { estado: 'degradado', detalle: `${m.enEspera} en espera y ningun worker aqui` }
        : { estado: 'ok', detalle: `${m.enEspera} en espera, ${m.activos} activos` };
    });

    this.cola = new Queue<DatosDelTrabajo>(NOMBRE_COLA_EVALUACION, {
      connection: this.conexion(),
      prefix: this.politica.prefijo,
      defaultJobOptions: opcionesDeTrabajo(this.politica),
    });
    // Sin oyente, un error de conexion de ioredis es una excepcion no manejada.
    this.cola.on('error', (e) => this.registrar('error', 'cola_error', { detalle: e.message }));

    // Criterio 1: el encolado ocurre fuera de la peticion del candidato, cuando
    // el bus entrega el evento. La respuesta HTTP ya salio.
    this.cancelarSuscripcion = this.bus.suscribir<EventoEntregaCompletada>(
      ENTREGA_COMPLETADA,
      async (evento) => {
        await this.encolar(evento.payload.idEntrega);
      },
    );

    if (this.politica.workerHabilitado) {
      this.worker = new Worker<DatosDelTrabajo>(
        NOMBRE_COLA_EVALUACION,
        (trabajo) => this.procesar(trabajo),
        {
          connection: this.conexion(),
          prefix: this.politica.prefijo,
          concurrency: this.politica.concurrencia,
          // Un trabajo que tumba al worker dos veces seguidas se da por
          // fallido: reintentarlo sin fin tumbaria a todos los workers.
          maxStalledCount: 2,
        },
      );
      this.worker.on('error', (e) =>
        this.registrar('error', 'worker_error', { detalle: e.message }),
      );
    }
  }

  onApplicationBootstrap(): void {
    if (!this.worker) return;
    const barrer = () => {
      this.reencolarPendientes(this.politica.antiguedadParaReencolarMs).catch((e: unknown) =>
        this.registrar('error', 'barrido_fallido', {
          detalle: e instanceof Error ? e.message : String(e),
        }),
      );
    };
    barrer();
    this.barrido = setInterval(barrer, this.politica.intervaloBarridoMs);
    this.barrido.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.cancelarSuscripcion?.();
    if (this.barrido) clearInterval(this.barrido);
    // close() espera a que terminen los trabajos en curso: un despliegue no
    // corta una evaluacion a medias.
    await this.worker?.close();
    await this.cola?.close();
  }

  /** Encola la evaluacion de una entrega. Idempotente. */
  async encolar(idEntrega: string): Promise<void> {
    await this.cola.add(NOMBRE_TRABAJO_EVALUACION, { idEntrega }, { jobId: idEntrega });
    this.registrar('log', 'evaluacion_encolada', { idEntrega });
  }

  /**
   * Vuelve a encolar las entregas `recibida` mas antiguas que `antiguedadMs`.
   * Las que ya estan en la cola no se duplican.
   */
  async reencolarPendientes(antiguedadMs: number): Promise<number> {
    const ids = await this.entregas.pendientesDeEvaluacion(antiguedadMs);
    if (ids.length === 0) return 0;
    await this.cola.addBulk(
      ids.map((idEntrega) => ({
        name: NOMBRE_TRABAJO_EVALUACION,
        data: { idEntrega },
        opts: { ...opcionesDeTrabajo(this.politica), jobId: idEntrega },
      })),
    );
    this.registrar('warn', 'entregas_reencoladas', { cantidad: ids.length });
    return ids.length;
  }

  /** Reintento manual de una evaluacion fallida, por un administrador. */
  async reintentarFallida(idEntrega: string, idAdministrador: string): Promise<void> {
    const datos = await this.entregas.datosParaEvaluacion(idEntrega);
    if (!datos) throw new NotFoundException('La entrega no existe.');
    if (datos.estado !== EstadoEntrega.Fallida) {
      throw new ConflictException('Solo se reintenta una entrega cuya evaluacion fallo.');
    }

    const trabajo = await this.cola.getJob(idEntrega);
    if (trabajo && (await trabajo.isFailed())) {
      await trabajo.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    } else if (!trabajo) {
      // Ya caduco la retencion de fallidos: se crea de nuevo.
      await this.encolar(idEntrega);
    } else {
      throw new ConflictException('La evaluacion de esta entrega ya esta en la cola.');
    }

    this.registrar('warn', 'evaluacion_reintentada_manualmente', {
      idEntrega,
      userId: idAdministrador,
    });
  }

  async metricas(): Promise<MetricasDeCola> {
    const c = await this.cola.getJobCounts(
      'waiting',
      'prioritized',
      'active',
      'delayed',
      'failed',
      'completed',
    );
    return {
      enEspera: (c.waiting ?? 0) + (c.prioritized ?? 0),
      activos: c.active ?? 0,
      reprogramados: c.delayed ?? 0,
      fallidos: c.failed ?? 0,
      completados: c.completed ?? 0,
      workerActivo: this.worker?.isRunning() ?? false,
    };
  }

  // --- Procesamiento ---

  private async procesar(job: Job<DatosDelTrabajo>): Promise<void> {
    const { idEntrega } = job.data;
    const datos = await this.entregas.datosParaEvaluacion(idEntrega);

    // La entrega se borro: no hay nada que reintentar.
    if (!datos) throw new UnrecoverableError('La entrega ya no existe.');
    // Idempotencia: ya evaluada, no se paga otra llamada al modelo.
    if (datos.estado === EstadoEntrega.Evaluada) return;

    // Criterio 3: en cuanto un worker la toma, el candidato la ve en evaluacion.
    // En los reintentos ya esta en ese estado y no se repite la transicion.
    if (datos.estado !== EstadoEntrega.EnEvaluacion) {
      const tomada = await this.cambiarSiProcede(
        idEntrega,
        EstadoEntrega.EnEvaluacion,
        datos.estado === EstadoEntrega.Fallida
          ? 'Reintento de la evaluacion'
          : 'Evaluacion iniciada',
      );
      if (!tomada) return;
    }

    const trabajo: TrabajoDeEvaluacion = {
      idEntrega,
      idVacante: datos.idVacante,
      idCandidato: datos.idCandidato,
      idEjercicio: datos.idEjercicio,
      numeroIntento: datos.numeroIntento,
    };
    const intento = job.attemptsMade + 1;
    const intentosTotales = job.opts.attempts ?? 1;

    try {
      await conTiempoLimite(
        (senal) => this.evaluador.evaluar(trabajo, senal),
        this.politica.timeoutMs,
      );
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      const noReintentable = error instanceof EvaluacionNoReintentableError;

      if (noReintentable || intento >= intentosTotales) {
        // Criterio 2, rama final: el trabajo no se pierde en silencio. La
        // entrega queda `fallida` y el trabajo en el conjunto de fallidos.
        // El motivo que ve el candidato es generico: el detalle tecnico puede
        // traer datos internos del proveedor y va solo al log.
        await this.cambiarSiProcede(
          idEntrega,
          EstadoEntrega.Fallida,
          noReintentable
            ? 'La entrega no pudo evaluarse'
            : `La evaluacion no pudo completarse tras ${intento} intento(s)`,
        );
        this.registrar('error', 'evaluacion_fallida', {
          idEntrega,
          intento,
          intentosTotales,
          noReintentable,
          detalle,
        });
        throw noReintentable ? new UnrecoverableError(detalle) : error;
      }

      this.registrar('warn', 'evaluacion_reintento_programado', {
        idEntrega,
        intento,
        intentosTotales,
        detalle,
      });
      throw error;
    }

    await this.cambiarSiProcede(idEntrega, EstadoEntrega.Evaluada, 'Evaluacion completada');
    this.registrar('log', 'evaluacion_completada', { idEntrega, intento });
  }

  /**
   * Cambia el estado salvo que otro proceso ya lo haya llevado mas lejos.
   *
   * Pasa con un trabajo "stalled": el worker original seguia vivo y otro lo
   * retomo. El que llega tarde no debe fallar ni sobrescribir: si la entrega
   * ya esta evaluada, devuelve false y el trabajo termina sin mas.
   */
  private async cambiarSiProcede(
    idEntrega: string,
    hacia: EstadoEntrega,
    motivo: string,
  ): Promise<boolean> {
    try {
      await this.entregas.cambiarEstado(idEntrega, hacia, motivo);
      return true;
    } catch (e) {
      if (!(e instanceof TransicionInvalidaError)) throw e;
      const actual = await this.entregas.datosParaEvaluacion(idEntrega);
      if (actual?.estado === EstadoEntrega.Evaluada) return false;
      if (actual?.estado === hacia) return true;
      throw e;
    }
  }

  private conexion(): RedisOptions {
    return {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env.REDIS_DB ?? 0),
    };
  }

  private registrar(nivel: 'log' | 'warn' | 'error', eventType: string, metadata: object): void {
    this.logger[nivel](
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: nivel === 'log' ? 'info' : nivel,
        eventType,
        metadata,
      }),
    );
  }
}
