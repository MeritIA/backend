/**
 * Eventos que publica el modulo de vacantes.
 *
 * El nombre es estable y forma parte del contrato con los suscriptores: el
 * modulo de notificaciones escucha este evento sin importar nada de este modulo
 * mas que estas dos declaraciones.
 *
 * POR QUE UN EVENTO Y NO UNA LLAMADA
 *
 * Cerrar una vacante es una operacion del reclutador y tiene que responder
 * rapido. Avisar por correo a los participantes es trabajo de otro modulo, que
 * tarda lo que tarde el servidor de salida y puede fallar. Con un evento, el
 * cierre no espera ni se cae por un buzon lleno.
 *
 * Y hay una razon de fronteras: quien sabe QUIEN participo es evaluacion, y
 * vacantes no puede preguntarselo —evaluacion ya importa vacantes, y la vuelta
 * cerraria un ciclo entre modulos—. El suscriptor vive en un modulo que
 * depende de los dos.
 */
export const VACANTE_CERRADA = 'vacantes.vacante-cerrada';

/** Datos del evento. Solo identificadores: nunca la entidad ni datos personales. */
export interface EventoVacanteCerrada {
  readonly idVacante: string;
  readonly idEmpresa: string;
  /** Quien la cerro. Va para la auditoria del aviso, no para el texto del correo. */
  readonly idUsuarioQueCerro: string;
}
