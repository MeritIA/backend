/** Lo que se avisa. Hoy solo el cierre; el tipo existe para que manana no haya otra tabla. */
export enum TipoDeAviso {
  VacanteCerrada = 'vacante_cerrada',
}

/**
 * En que va cada aviso.
 *
 * `enviando` no es decoracion: es la reserva de la fila. Dos cierres
 * simultaneos de la misma vacante, o un cierre y un reenvio a la vez, pasarian
 * los dos por la misma lista de candidatos; quien gana el UPDATE que pone
 * `enviando` es el unico que escribe el correo. Sin ese estado intermedio, el
 * candidato recibe el mismo aviso dos veces.
 *
 * `sin_canal` se distingue de `fallida` a proposito: la primera dice que no hay
 * SMTP configurado —no es un fallo, es un entorno sin canal— y la segunda que
 * el servidor rechazo el envio. Mezclarlas haria imposible saber si un reenvio
 * tiene sentido.
 */
export enum EstadoDeAviso {
  Pendiente = 'pendiente',
  Enviando = 'enviando',
  Enviada = 'enviada',
  Fallida = 'fallida',
  SinCanal = 'sin_canal',
}

/** Estados desde los que un aviso se puede intentar de nuevo. Nunca `enviada`. */
export const REINTENTABLES = [
  EstadoDeAviso.Pendiente,
  EstadoDeAviso.Fallida,
  EstadoDeAviso.SinCanal,
] as const;

/**
 * Cuanto se espera antes de volver a tomar una fila que quedo en `enviando`.
 *
 * Si el proceso se cae entre la reserva y el envio, la fila se queda ahi. Diez
 * minutos es mas que el tiempo de cualquier SMTP razonable, asi que pasado ese
 * rato se asume que nadie la esta enviando. El coste de equivocarse es un
 * correo repetido; el de no tenerlo, un candidato sin aviso para siempre.
 */
export const MINUTOS_PARA_DAR_POR_PERDIDO = 10;
