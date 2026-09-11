/**
 * Ciclo de vida de una vacante.
 *
 * Tres estados y un solo camino: se redacta en borrador, se publica cuando esta
 * lista, y se cierra cuando el proceso termina. No se vuelve atras.
 *
 *   borrador ──publicar──▶ publicada ──cerrar──▶ cerrada
 *       │                                            ▲
 *       └──────────────── cerrar ────────────────────┘
 *
 * Se permite cerrar un borrador (una vacante que se descarto antes de salir),
 * pero NO reabrir una cerrada ni despublicar una publicada. Un candidato que ya
 * vio una vacante y empezo a resolver sus ejercicios no puede encontrarse con
 * que la oferta desaparecio: eso rompe la trazabilidad que el Charter pone como
 * proposito del producto.
 */
export enum EstadoVacante {
  Borrador = 'borrador',
  Publicada = 'publicada',
  Cerrada = 'cerrada',
}

/** Transiciones permitidas, declaradas para que la regla se lea de un vistazo. */
const TRANSICIONES: Record<EstadoVacante, readonly EstadoVacante[]> = {
  [EstadoVacante.Borrador]: [EstadoVacante.Publicada, EstadoVacante.Cerrada],
  [EstadoVacante.Publicada]: [EstadoVacante.Cerrada],
  [EstadoVacante.Cerrada]: [],
};

export function puedeTransicionar(desde: EstadoVacante, hacia: EstadoVacante): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/**
 * Una vacante solo se edita mientras es borrador o esta publicada.
 *
 * Editar el enunciado de una vacante cerrada cambiaria el contexto de
 * evaluaciones ya emitidas.
 */
export function admiteEdicion(estado: EstadoVacante): boolean {
  return estado !== EstadoVacante.Cerrada;
}

/**
 * Los ejercicios solo se tocan en borrador.
 *
 * Cambiar los ejercicios de una vacante publicada dejaria a dos candidatos del
 * mismo proceso resolviendo pruebas distintas, y sus resultados dejarian de ser
 * comparables. Comparar candidatos con el mismo criterio es justo lo que el
 * Charter da como razon de ser de MeritIA.
 */
export function admiteCambioDeEjercicios(estado: EstadoVacante): boolean {
  return estado === EstadoVacante.Borrador;
}
