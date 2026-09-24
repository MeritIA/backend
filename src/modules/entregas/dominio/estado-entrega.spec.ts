import { describe, expect, it } from 'vitest';
import { EstadoEntrega, puedeTransicionar } from './estado-entrega.js';

const { Recibida, EnEvaluacion, Evaluada, Fallida } = EstadoEntrega;

describe('estados de una entrega', () => {
  it.each([
    [Recibida, EnEvaluacion],
    [EnEvaluacion, Evaluada],
    [EnEvaluacion, Fallida],
    [Fallida, EnEvaluacion],
  ])('permite %s -> %s', (desde, hacia) => {
    expect(puedeTransicionar(desde, hacia)).toBe(true);
  });

  it.each([
    // Saltarse la evaluacion daria una nota que nadie calculo.
    [Recibida, Evaluada],
    [Recibida, Fallida],
    // Evaluada es terminal: reabrirla cambiaria una nota ya comunicada.
    [Evaluada, EnEvaluacion],
    [Evaluada, Fallida],
    [Evaluada, Recibida],
    [Fallida, Evaluada],
    [EnEvaluacion, Recibida],
  ])('rechaza %s -> %s', (desde, hacia) => {
    expect(puedeTransicionar(desde, hacia)).toBe(false);
  });

  it('ningun estado transiciona a si mismo', () => {
    for (const estado of Object.values(EstadoEntrega)) {
      expect(puedeTransicionar(estado, estado)).toBe(false);
    }
  });
});
