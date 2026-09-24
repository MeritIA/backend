/**
 * Eventos que publica el modulo de entregas.
 *
 * El nombre es estable y forma parte del contrato con los suscriptores: el
 * modulo de evaluacion (paquete 4.5) escuchara este evento sin importar nada de
 * este modulo mas que estas dos declaraciones.
 */
export const ENTREGA_COMPLETADA = 'entregas.entrega-completada';

/** Datos del evento. Solo identificadores: nunca entidades ni el archivo. */
export interface EventoEntregaCompletada {
  readonly idEntrega: string;
  readonly idVacante: string;
  readonly idCandidato: string;
  readonly idEjercicio: string;
  readonly numeroIntento: number;
}
