/**
 * Eventos de seguridad que viajan por el bus interno (paquete 5.5).
 *
 * POR QUE POR EL BUS Y NO LLAMANDO AL SERVICIO DE ALERTAS
 *
 * El guardia de autenticacion, el de limites y el evaluador no tienen por que
 * saber que existen las alertas, ni menos aun como se envian. Publican lo que
 * pasa; quien quiera actuar se suscribe. Asi anadir manana un canal nuevo
 * —o un panel— no obliga a tocar los sitios donde ocurre el evento.
 */
export const EVENTO_DE_SEGURIDAD = 'seguridad.evento';

/**
 * Tipos que hoy disparan alerta, que son los tres del criterio del paquete:
 * "fallos de autenticacion repetidos, rate limit excedido e intentos de
 * inyeccion".
 */
export type TipoDeEventoDeSeguridad =
  'auth_failure' | 'rate_limit_exceeded' | 'inyeccion_detectada';

export interface EventoDeSeguridad {
  readonly tipo: TipoDeEventoDeSeguridad;
  /**
   * A quien se le cuenta. Es el usuario si hay sesion, y si no la IP: contar
   * los fallos de login de todo el mundo en un solo contador haria que una
   * oficina entera disparara la alerta de una persona.
   */
  readonly clave: string;
  /** Marca de tiempo, usuario, IP y ruta: lo que exige el criterio del paquete. */
  readonly momento: string;
  readonly userId?: string;
  readonly ip?: string;
  readonly ruta?: string;
  readonly metodo?: string;
  /** Detalle propio de cada tipo. Nunca credenciales ni contenido de entregas. */
  readonly metadata?: Record<string, unknown>;
}
