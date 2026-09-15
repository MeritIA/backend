import type { JobsOptions } from 'bullmq';

/**
 * Politica de la cola de evaluacion, paquete 4.1.
 *
 * Todo lo configurable vive aqui y se lee una vez del entorno, para que la
 * politica de reintentos se revise en un solo sitio y se pueda probar sin Redis.
 */
export const NOMBRE_COLA_EVALUACION = 'evaluaciones';
export const NOMBRE_TRABAJO_EVALUACION = 'evaluar-entrega';

export interface PoliticaDeCola {
  /** Prefijo de las claves en Redis. */
  readonly prefijo: string;
  /**
   * Si este proceso consume la cola. En produccion las instancias que atienden
   * la API pueden apagarlo y dejar el consumo a instancias dedicadas, de modo
   * que un pico de evaluaciones no quite capacidad a las peticiones.
   */
  readonly workerHabilitado: boolean;
  /** Evaluaciones simultaneas por proceso. */
  readonly concurrencia: number;
  /** Intentos totales por trabajo, incluido el primero. */
  readonly reintentos: number;
  /** Espera base del backoff exponencial: base, 2x, 4x... */
  readonly backoffMs: number;
  /** Tiempo maximo que se espera al servicio de IA en cada intento. */
  readonly timeoutMs: number;
  /** Cuanto se conservan los trabajos completados, para diagnostico. */
  readonly retencionCompletadosSeg: number;
  /** Cuanto se conservan los fallidos: son la cola de trabajos muertos. */
  readonly retencionFallidosSeg: number;
  /** Antiguedad a partir de la cual una entrega `recibida` se considera perdida. */
  readonly antiguedadParaReencolarMs: number;
  /** Cada cuanto se buscan entregas perdidas. */
  readonly intervaloBarridoMs: number;
}

function entero(valor: string | undefined, porDefecto: number, min: number, max: number): number {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const n = Number(valor);
  return Number.isInteger(n) && n >= min && n <= max ? n : porDefecto;
}

const HORA = 3600;

export function leerPoliticaDeCola(env: NodeJS.ProcessEnv = process.env): PoliticaDeCola {
  return {
    prefijo: env.COLA_PREFIJO?.trim() || 'meritia',
    workerHabilitado: env.COLA_WORKER_HABILITADO !== 'false',
    concurrencia: entero(env.COLA_CONCURRENCIA, 2, 1, 50),
    // Cinco intentos con base de 15 s: 15, 30, 60 y 120 s entre ellos. Casi
    // cuatro minutos cubren una caida breve del proveedor sin dejar al
    // candidato esperando horas por un fallo que no se va a arreglar solo.
    reintentos: entero(env.COLA_REINTENTOS, 5, 1, 20),
    backoffMs: entero(env.COLA_BACKOFF_MS, 15_000, 10, 3_600_000),
    // Una evaluacion con un modelo de lenguaje puede tardar minutos.
    timeoutMs: entero(env.COLA_TIMEOUT_MS, 120_000, 1_000, 3_600_000),
    retencionCompletadosSeg: 24 * HORA,
    retencionFallidosSeg: 30 * 24 * HORA,
    antiguedadParaReencolarMs: 2 * 60_000,
    intervaloBarridoMs: 5 * 60_000,
  };
}

export function opcionesDeTrabajo(politica: PoliticaDeCola): JobsOptions {
  return {
    attempts: politica.reintentos,
    // Jitter: si el proveedor cae y vuelve, que los reintentos no lleguen todos
    // en el mismo milisegundo y lo vuelvan a tumbar.
    backoff: { type: 'exponential', delay: politica.backoffMs, jitter: 0.2 },
    removeOnComplete: { age: politica.retencionCompletadosSeg },
    removeOnFail: { age: politica.retencionFallidosSeg },
  };
}
