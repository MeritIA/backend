/**
 * Lo que un candidato ha demostrado en una habilidad.
 *
 * La NORMALIZACION del nombre ya no vive aqui: se movio a
 * `ejercicios/dominio/habilidad.ts`, porque un nombre de habilidad es en origen
 * el nombre de un criterio de rubrica y el dueno del concepto es quien lo
 * define. Aqui queda lo que si es de evaluacion: el nivel medido.
 *
 * Y la normalizacion por si sola ya no es toda la traduccion: los sinonimos los
 * resuelve el vocabulario (`HabilidadesService.resolver`, ADR-0017).
 */
/** Nivel demostrado en una habilidad, de 0 a 1, con cuanta evidencia lo sostiene. */
export interface NivelDeHabilidad {
  /** El nombre tal como se escribio la ultima vez, para poder mostrarlo. */
  readonly nombre: string;
  /** Media de puntaje/escala en todas las veces que se califico. 0 a 1. */
  readonly nivel: number;
  /** Cuantas calificaciones lo sostienen. Uno no es lo mismo que seis. */
  readonly veces: number;
}
