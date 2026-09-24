/**
 * Reglas de una rubrica de evaluacion.
 *
 * La rubrica es la pieza que el motor de IA usara como **referencia obligatoria
 * de calificacion**. De su calidad depende que dos candidatos con el mismo
 * desempeno saquen la misma nota, que es la promesa del producto: el Charter
 * justifica MeritIA por lo poco estandarizados que son los criterios humanos.
 *
 * De ahi que estas validaciones sean estrictas. Una rubrica ambigua o mal
 * ponderada no falla de forma ruidosa: produce calificaciones que parecen
 * razonables y no lo son. Es el riesgo que la propia ficha del paquete señala.
 */

/** Los pesos de los criterios suman exactamente esto. */
export const PESO_TOTAL = 100;

/**
 * Tolerancia al comparar la suma.
 *
 * Los pesos se guardan con dos decimales y se suman en coma flotante, donde
 * 33,33 + 33,33 + 33,34 no da 100 exacto. Sin esta holgura, una rubrica
 * legitima de tres criterios iguales seria imposible de guardar.
 */
export const TOLERANCIA = 0.01;

export const MIN_CRITERIOS = 1;
export const MAX_CRITERIOS = 20;

export interface CriterioEntrada {
  readonly nombre: string;
  readonly descripcion: string;
  readonly peso: number;
  readonly escalaMaxima: number;
}

export type MotivoRubricaInvalida =
  | 'sin_criterios'
  | 'demasiados_criterios'
  | 'pesos_no_suman_cien'
  | 'peso_no_positivo'
  | 'escala_no_positiva'
  | 'nombres_repetidos';

export class RubricaInvalidaError extends Error {
  constructor(
    readonly motivo: MotivoRubricaInvalida,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/**
 * Valida la rubrica ANTES de guardar, que es lo que pide el segundo criterio de
 * aceptacion del paquete.
 *
 * Se valida aqui y no solo en los DTOs porque una regla que cruza varios campos
 * —la suma de los pesos— no pertenece a la validacion de un campo suelto, y
 * porque asi tambien la cumple cualquier version creada por otra via.
 */
export function validarRubrica(criterios: readonly CriterioEntrada[]): void {
  if (criterios.length < MIN_CRITERIOS) {
    throw new RubricaInvalidaError(
      'sin_criterios',
      'La rubrica necesita al menos un criterio: sin criterios no hay nada contra lo que calificar.',
    );
  }

  if (criterios.length > MAX_CRITERIOS) {
    throw new RubricaInvalidaError(
      'demasiados_criterios',
      `La rubrica admite como maximo ${MAX_CRITERIOS} criterios.`,
    );
  }

  const nombres = criterios.map((c) => c.nombre.trim().toLowerCase());
  if (new Set(nombres).size !== nombres.length) {
    throw new RubricaInvalidaError(
      'nombres_repetidos',
      'Dos criterios de la rubrica tienen el mismo nombre. Un evaluador no sabria a cual se refiere cada nota.',
    );
  }

  for (const criterio of criterios) {
    if (!(criterio.peso > 0)) {
      throw new RubricaInvalidaError(
        'peso_no_positivo',
        `El criterio "${criterio.nombre}" tiene peso ${criterio.peso}. Un criterio que no pesa no deberia estar en la rubrica.`,
      );
    }
    if (!Number.isInteger(criterio.escalaMaxima) || criterio.escalaMaxima < 1) {
      throw new RubricaInvalidaError(
        'escala_no_positiva',
        `El criterio "${criterio.nombre}" necesita una escala maxima entera y mayor que cero.`,
      );
    }
  }

  const suma = criterios.reduce((total, c) => total + c.peso, 0);
  if (Math.abs(suma - PESO_TOTAL) > TOLERANCIA) {
    throw new RubricaInvalidaError(
      'pesos_no_suman_cien',
      `Los pesos de los criterios suman ${redondear(suma)} y deben sumar ${PESO_TOTAL}. ` +
        'Con otra suma, la nota final no seria comparable entre ejercicios.',
    );
  }
}

/** Nota final sobre 100, ponderando cada criterio por su peso. */
export function calcularNotaPonderada(
  criterios: readonly { peso: number; escalaMaxima: number }[],
  puntajes: readonly number[],
): number {
  if (criterios.length !== puntajes.length) {
    throw new RubricaInvalidaError(
      'sin_criterios',
      'Hay que dar un puntaje por cada criterio de la rubrica, ni mas ni menos.',
    );
  }

  const total = criterios.reduce((acumulado, criterio, i) => {
    const puntaje = puntajes[i];
    if (puntaje < 0 || puntaje > criterio.escalaMaxima) {
      throw new RubricaInvalidaError(
        'escala_no_positiva',
        `El puntaje ${puntaje} queda fuera de la escala 0-${criterio.escalaMaxima} del criterio.`,
      );
    }
    return acumulado + (puntaje / criterio.escalaMaxima) * criterio.peso;
  }, 0);

  return redondear(total);
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
