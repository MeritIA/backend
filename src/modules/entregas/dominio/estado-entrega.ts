/**
 * Ciclo de vida de una entrega.
 *
 *   recibida ──▶ en_evaluacion ──▶ evaluada
 *                     │  ▲
 *                     ▼  │ (reintento de la evaluacion)
 *                   fallida
 *
 * `fallida` significa que fallo la EVALUACION —el servicio de IA no respondio,
 * por ejemplo—, no que el candidato suspendiera. Por eso admite volver a
 * `en_evaluacion`: reintentar la calificacion no gasta un intento del
 * candidato, que no tuvo ninguna culpa.
 *
 * `evaluada` es final. Una nota emitida no se recalcula cambiando el estado;
 * si hubiera que corregirla, seria otra evaluacion con su propio registro.
 */
export enum EstadoEntrega {
  Recibida = 'recibida',
  EnEvaluacion = 'en_evaluacion',
  Evaluada = 'evaluada',
  Fallida = 'fallida',
}

const TRANSICIONES: Record<EstadoEntrega, readonly EstadoEntrega[]> = {
  [EstadoEntrega.Recibida]: [EstadoEntrega.EnEvaluacion],
  [EstadoEntrega.EnEvaluacion]: [EstadoEntrega.Evaluada, EstadoEntrega.Fallida],
  [EstadoEntrega.Fallida]: [EstadoEntrega.EnEvaluacion],
  [EstadoEntrega.Evaluada]: [],
};

export function puedeTransicionar(desde: EstadoEntrega, hacia: EstadoEntrega): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Limites del numero de intentos que un reclutador puede fijar en una vacante. */
export const INTENTOS_MINIMOS = 1;
export const INTENTOS_MAXIMOS = 10;
