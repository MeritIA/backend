/**
 * Como va una vacante abierta: lo que la pantalla A02 llama "avance".
 *
 * Vive en el dominio y es puro porque es una DECISION, no un calculo obvio:
 * elegir el denominador de una barra de progreso cambia lo que el reclutador
 * cree que esta pasando. Aqui se puede leer, discutir y probar sin base de
 * datos.
 *
 * EL DENOMINADOR SON LOS INVITADOS, NO EL PLAN
 *
 * Se considero dividir por `finalistasAEvaluar` —lo que la empresa planeo en
 * A04— y se descarta: ese numero lo puede cambiar el reclutador a mitad del
 * proceso, y la barra retrocederia sin que nadie hubiera deshecho nada. El plan
 * viaja igual en la respuesta, para que la pantalla pueda decir "12 evaluados
 * de 10 planeados" cuando se paso.
 *
 * NULL NO ES CERO
 *
 * Sin nadie invitado el avance es `null`, no 0. Un 0% dice "esto esta parado" y
 * la pantalla pondria una barra vacia con cara de problema; la verdad es que el
 * proceso no ha empezado y lo que hay que mostrar es "invita candidatos".
 * Confundirlos hace que el panel mienta justo en la vacante recien publicada.
 *
 * POR QUE TAMBIEN VAN LAS CIFRAS CRUDAS
 *
 * Porque el porcentaje solo no distingue dos procesos que piden cosas
 * distintas: uno donde nadie entrego —problema de convocatoria— y otro donde
 * todos entregaron y la cola de evaluacion va lenta —problema de operacion—.
 * Los dos pueden ir al 20 %.
 */

/** Lo que el modulo de vacantes sabe de una vacante abierta. */
export interface VacanteParaProgreso {
  readonly id: string;
  readonly titulo: string;
  readonly publicadaEn: Date | null;
  readonly cierreEstimado: Date | null;
  readonly finalistasAEvaluar: number | null;
  readonly invitados: number;
}

export interface ProgresoDeVacante {
  id: string;
  titulo: string;
  publicadaEn: Date | null;
  cierreEstimado: Date | null;
  /** Lo planeado en A04. Null si no se planeo. */
  finalistasAEvaluar: number | null;
  /** Candidatos invitados. Denominador del avance. */
  invitados: number;
  /** PERSONAS con al menos una entrega, no entregas: quien reintenta es una. */
  conEntrega: number;
  /** PERSONAS con evaluacion. Numerador del avance. */
  evaluados: number;
  /** 0 a 100, o null si no hay nadie invitado. */
  avance: number | null;
}

/**
 * Compone el progreso de una vacante con lo que cuentan los otros modulos.
 *
 * Los dos mapas vienen indexados por identificador de vacante y pueden no
 * tener la clave: una vacante recien publicada no aparece en ninguno porque
 * nadie ha entregado nada. Faltar ahi significa cero, no error.
 */
export function progresoDe(
  vacante: VacanteParaProgreso,
  conEntrega: Readonly<Record<string, number>>,
  evaluados: Readonly<Record<string, number>>,
): ProgresoDeVacante {
  const yaEvaluados = evaluados[vacante.id] ?? 0;

  return {
    id: vacante.id,
    titulo: vacante.titulo,
    publicadaEn: vacante.publicadaEn,
    cierreEstimado: vacante.cierreEstimado,
    finalistasAEvaluar: vacante.finalistasAEvaluar,
    invitados: vacante.invitados,
    conEntrega: conEntrega[vacante.id] ?? 0,
    evaluados: yaEvaluados,
    avance: vacante.invitados === 0 ? null : porcentaje(yaEvaluados, vacante.invitados),
  };
}

/**
 * Redondea al entero mas cercano, pero NO deja que un proceso sin terminar
 * muestre 100.
 *
 * Con 199 invitados y 198 evaluados el redondeo da 100 % y el reclutador cierra
 * la vacante creyendo que no falta nadie. En ese caso se queda en 99: el unico
 * 100 que este panel muestra es el que de verdad no deja a nadie fuera.
 */
function porcentaje(parte: number, total: number): number {
  const crudo = (parte / total) * 100;
  const redondeado = Math.round(crudo);
  return redondeado === 100 && parte < total ? 99 : redondeado;
}
