import { Injectable } from '@nestjs/common';

/**
 * Contrato entre la cola y quien evalua de verdad.
 *
 * La cola (4.1) sabe encolar, reintentar y marcar estados; no sabe hablar con
 * el servicio de IA. Eso lo hara el adaptador del paquete 4.4 y la persistencia
 * del resultado el 4.5, implementando esta interfaz. Cambiar de proveedor es
 * cambiar el adaptador que se registra con el token EVALUADOR.
 */
export const EVALUADOR = Symbol('EVALUADOR');

export interface TrabajoDeEvaluacion {
  readonly idEntrega: string;
  readonly idVacante: string;
  readonly idCandidato: string;
  readonly idEjercicio: string;
  readonly numeroIntento: number;
}

export interface Evaluador {
  /**
   * Evalua una entrega. Resuelve si termino; lanza si no.
   *
   * `senal` se aborta cuando se agota el tiempo del intento: el adaptador debe
   * cancelar la llamada al servicio de IA en lugar de dejarla colgada.
   */
  evaluar(trabajo: TrabajoDeEvaluacion, senal: AbortSignal): Promise<void>;
}

/** Fallo transitorio: caida, timeout, 5xx. Se reintenta segun la politica. */
export class ServicioDeIaNoDisponibleError extends Error {
  override readonly name = 'ServicioDeIaNoDisponibleError';
}

/**
 * Fallo que no se arregla reintentando: la entrega no se puede evaluar tal como
 * esta (formato ilegible, salida del modelo que viola el contrato una y otra
 * vez). Reintentar solo gastaria dinero de computo.
 */
export class EvaluacionNoReintentableError extends Error {
  override readonly name = 'EvaluacionNoReintentableError';
}

/**
 * Evaluador por omision mientras no exista el servicio de IA (paquete 4.4).
 *
 * Falla de forma honesta en lugar de inventar una nota: las entregas agotan
 * sus reintentos, quedan `fallida` y un administrador puede reintentarlas
 * cuando el servicio este conectado.
 */
@Injectable()
export class EvaluadorSinServicioDeIa implements Evaluador {
  evaluar(): Promise<void> {
    return Promise.reject(
      new ServicioDeIaNoDisponibleError('El servicio de IA (paquete 4.4) aun no esta conectado.'),
    );
  }
}
