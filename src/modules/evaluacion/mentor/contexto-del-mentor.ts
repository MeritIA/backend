import type { PeticionDeMentor } from '../cola/cliente-servicio-ia.js';

/** Las columnas de una evaluacion que el mentor necesita; nada mas sale del modulo. */
export interface EvaluacionParaMentor {
  readonly notaFinal: number;
  readonly titulo: string | null;
  readonly criterios: readonly {
    readonly criterio: string;
    readonly puntaje: number;
    readonly escalaMaxima: number;
    readonly evidencia: string;
  }[];
}

const MAX_CRITERIOS_EN_PERFIL = 12;
const MAX_RECIENTES = 3;
const MAX_EVIDENCIA = 160;

const redondear = (n: number): number => Math.round(n * 10) / 10;
const porcentaje = (puntaje: number, escala: number): number =>
  escala > 0 ? redondear((puntaje / escala) * 100) : 0;

/**
 * Lo que el mentor sabe del candidato, reducido a lo que hace falta para
 * aconsejar. Es el corazon del ahorro de tokens: se calcula aqui, con codigo,
 * en vez de mandarle al modelo todas las evaluaciones para que las resuma.
 *
 * Recibe las evaluaciones de la mas nueva a la mas vieja.
 *
 * No incluye nada que identifique a la persona ni a la empresa, ni el
 * enunciado, ni la entrega: solo numeros, nombres de criterio, el titulo del
 * reto y una evidencia recortada de lo que salio mas flojo.
 */
export function construirContexto(
  evaluaciones: readonly EvaluacionParaMentor[],
): PeticionDeMentor['contexto'] {
  const promedio =
    evaluaciones.length === 0
      ? 0
      : redondear(evaluaciones.reduce((a, e) => a + e.notaFinal, 0) / evaluaciones.length);

  const acumulado = new Map<string, { suma: number; veces: number }>();
  for (const e of evaluaciones) {
    for (const c of e.criterios) {
      const previo = acumulado.get(c.criterio) ?? { suma: 0, veces: 0 };
      acumulado.set(c.criterio, {
        suma: previo.suma + porcentaje(c.puntaje, c.escalaMaxima),
        veces: previo.veces + 1,
      });
    }
  }
  const perfil = [...acumulado.entries()]
    .map(([nombre, { suma, veces }]) => ({ nombre, porcentaje: redondear(suma / veces), veces }))
    // Los que mas se repiten dicen mas del candidato; el empate lo gana el mas flojo.
    .sort((a, b) => b.veces - a.veces || a.porcentaje - b.porcentaje)
    .slice(0, MAX_CRITERIOS_EN_PERFIL);

  const recientes = evaluaciones.slice(0, MAX_RECIENTES).map((e) => {
    const peor = [...e.criterios].sort(
      (a, b) => porcentaje(a.puntaje, a.escalaMaxima) - porcentaje(b.puntaje, b.escalaMaxima),
    )[0];
    return {
      reto: e.titulo ?? 'Reto',
      nota: redondear(e.notaFinal),
      ...(peor
        ? {
            flojo: {
              criterio: peor.criterio,
              porcentaje: porcentaje(peor.puntaje, peor.escalaMaxima),
              evidencia: peor.evidencia.replace(/\s+/g, ' ').trim().slice(0, MAX_EVIDENCIA),
            },
          }
        : {}),
    };
  });

  return { totalEvaluaciones: evaluaciones.length, promedio, perfil, recientes };
}
