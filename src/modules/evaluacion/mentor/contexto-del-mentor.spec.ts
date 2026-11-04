import { describe, expect, it } from 'vitest';
import { construirContexto, type EvaluacionParaMentor } from './contexto-del-mentor.js';

const evaluacion = (
  notaFinal: number,
  titulo: string,
  criterios: [string, number, number][],
): EvaluacionParaMentor => ({
  notaFinal,
  titulo,
  criterios: criterios.map(([criterio, puntaje, escalaMaxima]) => ({
    criterio,
    puntaje,
    escalaMaxima,
    evidencia: `evidencia de ${criterio}`,
  })),
});

describe('construirContexto', () => {
  it('sin evaluaciones, todo en cero', () => {
    expect(construirContexto([])).toEqual({
      totalEvaluaciones: 0,
      promedio: 0,
      perfil: [],
      recientes: [],
    });
  });

  it('promedia por criterio en porcentaje y marca el mas flojo de cada reciente', () => {
    const c = construirContexto([
      evaluacion(80, 'Reto B', [
        ['Correccion', 5, 5],
        ['Claridad', 5, 10],
      ]),
      evaluacion(60, 'Reto A', [
        ['Correccion', 3, 5],
        ['Claridad', 3, 10],
      ]),
    ]);
    expect(c.promedio).toBe(70);
    expect(c.perfil).toContainEqual({ nombre: 'Correccion', porcentaje: 80, veces: 2 });
    expect(c.perfil).toContainEqual({ nombre: 'Claridad', porcentaje: 40, veces: 2 });
    expect(c.recientes[0]).toMatchObject({
      reto: 'Reto B',
      flojo: { criterio: 'Claridad', porcentaje: 50 },
    });
  });

  it('solo manda tres recientes y recorta la evidencia', () => {
    const largas = Array.from({ length: 5 }, (_, i) => ({
      ...evaluacion(50, `R${i}`, [['X', 1, 5]]),
      criterios: [{ criterio: 'X', puntaje: 1, escalaMaxima: 5, evidencia: 'e'.repeat(1000) }],
    }));
    const c = construirContexto(largas);
    expect(c.recientes).toHaveLength(3);
    expect(c.recientes[0].flojo!.evidencia).toHaveLength(160);
    expect(c.totalEvaluaciones).toBe(5);
  });
});
