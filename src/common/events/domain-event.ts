/**
 * Evento de dominio interno.
 *
 * El planteamiento de arquitectura pide que el flujo de evaluacion —que encadena
 * entregas, evaluacion y reportes— viaje por eventos internos y no por llamadas
 * directas entre modulos. Asi cada modulo queda desacoplado del siguiente y
 * extraerlo mas adelante a un servicio propio es un trabajo acotado.
 */
export interface DomainEvent<TPayload = unknown> {
  /** Nombre estable del evento, en la forma `modulo.hecho-ocurrido`. */
  readonly name: string;
  /** Momento en que ocurrio el hecho, en UTC. */
  readonly occurredAt: Date;
  /** Datos del hecho. Nunca entidades: solo lo que el consumidor necesita. */
  readonly payload: TPayload;
}
