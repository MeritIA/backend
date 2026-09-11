import { describe, expect, it } from 'vitest';
import {
  RubricaInvalidaError,
  calcularNotaPonderada,
  validarRubrica,
  type CriterioEntrada,
} from './rubrica.js';

// El nombre por defecto lleva un contador: dos criterios con el mismo peso
// tendrian el mismo nombre y saltaria la validacion de nombres repetidos antes
// que la de pesos, que es lo que se quiere comprobar.
let secuencia = 0;
const criterio = (peso: number, nombre?: string): CriterioEntrada => ({
  nombre: nombre ?? `criterio-${++secuencia}`,
  descripcion: 'Descripcion suficientemente larga para el criterio.',
  peso,
  escalaMaxima: 5,
});

function motivoDe(fn: () => void): string {
  try {
    fn();
    return 'no-lanzo';
  } catch (e) {
    return e instanceof RubricaInvalidaError ? e.motivo : 'otro-error';
  }
}

describe('validacion de rubricas', () => {
  describe('CRITERIO: los pesos se validan antes de guardar', () => {
    it('acepta pesos que suman exactamente 100', () => {
      expect(() => validarRubrica([criterio(40), criterio(35), criterio(25)])).not.toThrow();
      expect(() => validarRubrica([criterio(100)])).not.toThrow();
    });

    it('rechaza pesos que suman de menos', () => {
      expect(motivoDe(() => validarRubrica([criterio(40), criterio(30)]))).toBe(
        'pesos_no_suman_cien',
      );
    });

    it('rechaza pesos que suman de mas', () => {
      expect(motivoDe(() => validarRubrica([criterio(60), criterio(60)]))).toBe(
        'pesos_no_suman_cien',
      );
    });

    it('el mensaje dice cuanto suman y cuanto deberian', () => {
      try {
        validarRubrica([criterio(40), criterio(30)]);
        expect.unreachable('deberia haber lanzado');
      } catch (e) {
        expect((e as Error).message).toContain('70');
        expect((e as Error).message).toContain('100');
      }
    });

    it('ADMITE tres criterios de 33,33 / 33,33 / 33,34', () => {
      // En coma flotante esta suma no da 100 exacto. Sin tolerancia, una
      // rubrica legitima de tres criterios iguales seria imposible de guardar.
      expect(() =>
        validarRubrica([criterio(33.33), criterio(33.33), criterio(33.34)]),
      ).not.toThrow();
    });

    it('sigue rechazando una desviacion real, no solo la del redondeo', () => {
      expect(motivoDe(() => validarRubrica([criterio(33.3), criterio(33.3), criterio(33.3)]))).toBe(
        'pesos_no_suman_cien',
      );
    });
  });

  describe('forma de la rubrica', () => {
    it('exige al menos un criterio', () => {
      expect(motivoDe(() => validarRubrica([]))).toBe('sin_criterios');
    });

    it('rechaza un peso de cero o negativo', () => {
      expect(motivoDe(() => validarRubrica([criterio(100), criterio(0, 'nulo')]))).toBe(
        'peso_no_positivo',
      );
      expect(motivoDe(() => validarRubrica([criterio(110), criterio(-10, 'negativo')]))).toBe(
        'peso_no_positivo',
      );
    });

    it('rechaza una escala que no sea entera y positiva', () => {
      for (const escala of [0, -1, 2.5]) {
        expect(motivoDe(() => validarRubrica([{ ...criterio(100), escalaMaxima: escala }]))).toBe(
          'escala_no_positiva',
        );
      }
    });

    it('rechaza dos criterios con el mismo nombre', () => {
      // Un evaluador no sabria a cual corresponde cada nota.
      expect(
        motivoDe(() => validarRubrica([criterio(50, 'Claridad'), criterio(50, 'Claridad')])),
      ).toBe('nombres_repetidos');
    });

    it('detecta nombres repetidos aunque cambien mayusculas o espacios', () => {
      expect(
        motivoDe(() => validarRubrica([criterio(50, 'Claridad'), criterio(50, '  claridad ')])),
      ).toBe('nombres_repetidos');
    });

    it('rechaza mas de veinte criterios', () => {
      const muchos = Array.from({ length: 21 }, (_, i) => criterio(100 / 21, `criterio-${i}`));
      expect(motivoDe(() => validarRubrica(muchos))).toBe('demasiados_criterios');
    });
  });

  describe('nota ponderada', () => {
    const rubrica = [
      { peso: 50, escalaMaxima: 5 },
      { peso: 30, escalaMaxima: 10 },
      { peso: 20, escalaMaxima: 1 },
    ];

    it('el maximo en todo da 100', () => {
      expect(calcularNotaPonderada(rubrica, [5, 10, 1])).toBe(100);
    });

    it('el minimo en todo da 0', () => {
      expect(calcularNotaPonderada(rubrica, [0, 0, 0])).toBe(0);
    });

    it('pondera cada criterio por su peso, no por su escala', () => {
      // El maximo del criterio que pesa 50 vale mas que el del que pesa 20,
      // aunque sus escalas sean 5 y 1.
      expect(calcularNotaPonderada(rubrica, [5, 0, 0])).toBe(50);
      expect(calcularNotaPonderada(rubrica, [0, 0, 1])).toBe(20);
    });

    it('la mitad de la escala da la mitad del peso', () => {
      expect(calcularNotaPonderada(rubrica, [0, 5, 0])).toBe(15);
    });

    it('rechaza un puntaje fuera de la escala del criterio', () => {
      expect(motivoDe(() => calcularNotaPonderada(rubrica, [6, 0, 0]))).toBe('escala_no_positiva');
      expect(motivoDe(() => calcularNotaPonderada(rubrica, [-1, 0, 0]))).toBe('escala_no_positiva');
    });

    it('exige un puntaje por criterio, ni mas ni menos', () => {
      expect(motivoDe(() => calcularNotaPonderada(rubrica, [5, 10]))).toBe('sin_criterios');
      expect(motivoDe(() => calcularNotaPonderada(rubrica, [5, 10, 1, 3]))).toBe('sin_criterios');
    });
  });
});
