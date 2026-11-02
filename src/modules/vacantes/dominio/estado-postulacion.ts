/**
 * Ciclo de vida de una postulacion.
 *
 * Tres estados y un solo paso: alguien se postula y queda en revision, y el
 * reclutador la acepta o la rechaza. No se vuelve atras.
 *
 *   en_revision ──aceptar──▶ aceptada
 *        │
 *        └──────rechazar───▶ rechazada
 *
 * NO SE PUEDE DESHACER, Y ES DELIBERADO
 *
 * Aceptar invita al candidato, y la invitacion es lo que le deja empezar el
 * reto. Si "des-aceptar" existiera, alguien podria quedarse a medio reto porque
 * la empresa cambio de opinion, y eso rompe la trazabilidad que el Charter pone
 * como proposito del producto. Rechazar tampoco se revierte: el candidato ya
 * recibio el motivo, y cambiar la decision sin que el se entere seria peor que
 * mantenerla. Si la empresa se equivoco, puede invitarlo igual --`aceptar` no
 * es el unico camino a una invitacion-- y queda registrado como lo que es: un
 * acto nuevo, no la reescritura de uno viejo.
 */
export enum EstadoPostulacion {
  EnRevision = 'en_revision',
  Aceptada = 'aceptada',
  Rechazada = 'rechazada',
}

/** Transiciones permitidas, declaradas para que la regla se lea de un vistazo. */
const TRANSICIONES: Record<EstadoPostulacion, readonly EstadoPostulacion[]> = {
  [EstadoPostulacion.EnRevision]: [EstadoPostulacion.Aceptada, EstadoPostulacion.Rechazada],
  [EstadoPostulacion.Aceptada]: [],
  [EstadoPostulacion.Rechazada]: [],
};

export function puedeDecidirse(desde: EstadoPostulacion): boolean {
  return TRANSICIONES[desde].length > 0;
}

export function puedeTransicionar(desde: EstadoPostulacion, hacia: EstadoPostulacion): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/**
 * Longitud minima del motivo de un rechazo.
 *
 * No es burocracia: es el unico dato que el candidato recibe cuando no avanza,
 * y "no" no explica nada. Con un minimo, quien rechaza tiene que escribir algo
 * que se pueda leer. Es la misma idea que la evidencia obligatoria por criterio
 * en la calificacion: una decision sin razon escrita no es auditable.
 */
export const LONGITUD_MINIMA_DEL_MOTIVO = 20;
