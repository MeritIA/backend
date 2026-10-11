/**
 * Eventos que publica el modulo de evaluacion.
 *
 * El criterio del paquete 4.5 lo pide asi: "la finalizacion de una evaluacion
 * queda disponible para el modulo de reportes por evento interno". Reportes se
 * suscribira a este nombre sin importar nada mas de evaluacion.
 */
export const EVALUACION_FINALIZADA = 'evaluacion.evaluacion-finalizada';

/** Solo identificadores y la nota: el desglose se consulta por la puerta del modulo. */
export interface EventoEvaluacionFinalizada {
  readonly idEvaluacion: string;
  readonly idEntrega: string;
  readonly idVacante: string;
  readonly idCandidato: string;
  readonly idEmpresa: string;
  readonly notaFinal: number;
}
