/**
 * Eventos que publica el modulo de autenticacion.
 *
 * Quien tiene datos de la persona en otro modulo (fotos de verificacion,
 * postulaciones) escucha este evento y borra lo suyo: autenticacion no puede
 * llamarlos, porque ellos ya la importan a ella.
 */
export const CUENTA_ELIMINADA = 'autenticacion.cuenta-eliminada';

/** Solo el identificador: la persona ya no esta. */
export interface EventoCuentaEliminada {
  readonly idUsuario: string;
}
