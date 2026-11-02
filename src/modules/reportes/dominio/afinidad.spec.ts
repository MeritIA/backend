import { describe, expect, it } from 'vitest';
import { calcularAfinidad, exigenciasDe, type CriterioExigido } from './afinidad.js';
import type { NivelDeHabilidad } from '../../evaluacion/index.js';

/** Un perfil, escrito como se lee: nombre -> nivel de 0 a 1. */
function perfil(
  entradas: Record<string, number | [number, number]>,
): Map<string, NivelDeHabilidad> {
  const mapa = new Map<string, NivelDeHabilidad>();
  for (const [nombre, valor] of Object.entries(entradas)) {
    const [nivel, veces] = Array.isArray(valor) ? valor : [valor, 1];
    mapa.set(nombre, { nombre, nivel, veces });
  }
  return mapa;
}

const RUBRICA: CriterioExigido[] = [
  { nombre: 'Correccion funcional', peso: 70 },
  { nombre: 'Claridad del codigo', peso: 30 },
];

describe('% de afinidad', () => {
  describe('sin evidencia no hay numero, y no es cero', () => {
    it('un candidato que no ha hecho ninguna prueba tiene afinidad desconocida', () => {
      const a = calcularAfinidad(RUBRICA, perfil({}));
      // Un cero diria "no encajas" a quien no ha tenido oportunidad de
      // demostrar nada. Es la misma distincion que `avance === null` en A02.
      expect(a.porcentaje).toBeNull();
      expect(a.cobertura).toBe(0);
    });

    it('pero el desglose igual dice que se pedia, para poder explicarlo', () => {
      const a = calcularAfinidad(RUBRICA, perfil({}));
      expect(a.criterios).toHaveLength(2);
      expect(a.criterios[0]).toMatchObject({
        nombre: 'Correccion funcional',
        nivel: null,
        veces: 0,
      });
    });

    it('tener evidencia de OTRAS habilidades no cuenta: tiene que ser de lo que se pide', () => {
      const a = calcularAfinidad(RUBRICA, perfil({ 'modelado de datos': 1 }));
      expect(a.porcentaje).toBeNull();
    });

    it('una vacante sin rubrica no da numero en vez de dar cero', () => {
      expect(calcularAfinidad([], perfil({ 'correccion funcional': 1 })).porcentaje).toBeNull();
    });
  });

  describe('la media se pondera por el peso', () => {
    it('todo perfecto es 100', () => {
      const a = calcularAfinidad(
        RUBRICA,
        perfil({ 'correccion funcional': 1, 'claridad del codigo': 1 }),
      );
      expect(a.porcentaje).toBe(100);
      expect(a.cobertura).toBe(100);
    });

    it('el criterio que mas pesa manda', () => {
      // 70 % x 100 + 30 % x 0 = 70
      const a = calcularAfinidad(
        RUBRICA,
        perfil({ 'correccion funcional': 1, 'claridad del codigo': 0 }),
      );
      expect(a.porcentaje).toBe(70);
    });

    it('y al reves pesa poco', () => {
      // 70 % x 0 + 30 % x 100 = 30
      const a = calcularAfinidad(
        RUBRICA,
        perfil({ 'correccion funcional': 0, 'claridad del codigo': 1 }),
      );
      expect(a.porcentaje).toBe(30);
    });
  });

  describe('lo que no tiene evidencia no cuenta como cero, y la cobertura lo delata', () => {
    it('evidencia solo del criterio que mas pesa', () => {
      const a = calcularAfinidad(RUBRICA, perfil({ 'correccion funcional': 0.9 }));
      // Se promedia SOLO sobre el 70 que si tiene evidencia: 90, no 63.
      expect(a.porcentaje).toBe(90);
      expect(a.cobertura).toBe(70);
    });

    it('un 100 con poca cobertura sigue siendo un 100, y por eso viaja la cobertura', () => {
      const a = calcularAfinidad(RUBRICA, perfil({ 'claridad del codigo': 1 }));
      expect(a.porcentaje).toBe(100);
      // Este es el numero que impide que ese 100 engane: solo el 30 % de la
      // rubrica se comprobo. La pantalla tiene que ensenar los dos.
      expect(a.cobertura).toBe(30);
    });

    it('la cobertura llega al 100 solo con evidencia de todo', () => {
      const a = calcularAfinidad(
        RUBRICA,
        perfil({ 'correccion funcional': 0.5, 'claridad del codigo': 0.5 }),
      );
      expect(a.cobertura).toBe(100);
      expect(a.porcentaje).toBe(50);
    });
  });

  describe('el nombre del criterio se normaliza, porque lo escriben personas', () => {
    it('acentos, mayusculas y espacios de sobra son la misma habilidad', () => {
      const a = calcularAfinidad(
        [{ nombre: '  Corrección   FUNCIONAL ', peso: 100 }],
        perfil({ 'correccion funcional': 1 }),
      );
      expect(a.porcentaje).toBe(100);
    });

    it('pero un sinonimo NO: es una habilidad distinta, y es el limite conocido', () => {
      // "Legibilidad" y "Claridad del codigo" las juntaria una persona. Este
      // codigo no, y esta prueba existe para que el limite este escrito en vez
      // de descubrirse con un numero raro en una demostracion.
      const a = calcularAfinidad(
        [{ nombre: 'Claridad del codigo', peso: 100 }],
        perfil({ legibilidad: 1 }),
      );
      expect(a.porcentaje).toBeNull();
    });
  });

  describe('el nivel sale de puntaje/escala, no del puntaje', () => {
    it('un 4 sobre 5 y un 8 sobre 10 son el mismo nivel', () => {
      const cuatroDeCinco = calcularAfinidad([{ nombre: 'a', peso: 100 }], perfil({ a: 4 / 5 }));
      const ochoDeDiez = calcularAfinidad([{ nombre: 'a', peso: 100 }], perfil({ a: 8 / 10 }));
      expect(cuatroDeCinco.porcentaje).toBe(ochoDeDiez.porcentaje);
      expect(cuatroDeCinco.porcentaje).toBe(80);
    });
  });

  describe('las exigencias de varios ejercicios', () => {
    it('un solo ejercicio conserva sus pesos', () => {
      expect(exigenciasDe([RUBRICA])).toEqual(RUBRICA);
    });

    it('dos ejercicios valen lo mismo, asi que cada uno aporta la mitad', () => {
      const otra: CriterioExigido[] = [{ nombre: 'Modelado de datos', peso: 100 }];
      const unidas = exigenciasDe([RUBRICA, otra]);

      const total = unidas.reduce((s, c) => s + c.peso, 0);
      expect(total).toBeCloseTo(100, 5);
      expect(unidas.find((c) => c.nombre === 'Modelado de datos')!.peso).toBeCloseTo(50, 5);
      expect(unidas.find((c) => c.nombre === 'Correccion funcional')!.peso).toBeCloseTo(35, 5);
    });

    it('detallar una rubrica no le da mas peso a ese ejercicio', () => {
      // Ocho criterios no es mas importante que uno: es mas detallado.
      const detallada: CriterioExigido[] = Array.from({ length: 8 }, (_, i) => ({
        nombre: `criterio ${i}`,
        peso: 12.5,
      }));
      const simple: CriterioExigido[] = [{ nombre: 'unico', peso: 100 }];

      const unidas = exigenciasDe([detallada, simple]);
      const pesoDeLaDetallada = unidas
        .filter((c) => c.nombre.startsWith('criterio'))
        .reduce((s, c) => s + c.peso, 0);

      expect(pesoDeLaDetallada).toBeCloseTo(50, 5);
      expect(unidas.find((c) => c.nombre === 'unico')!.peso).toBeCloseTo(50, 5);
    });

    it('un criterio repetido en dos ejercicios suma: la vacante lo pide dos veces', () => {
      const unidas = exigenciasDe([
        [{ nombre: 'Correccion funcional', peso: 100 }],
        [{ nombre: 'correccion funcional', peso: 100 }],
      ]);
      expect(unidas).toHaveLength(1);
      expect(unidas[0].peso).toBeCloseTo(100, 5);
    });

    it('un ejercicio sin criterios no reparte peso ni rompe la cuenta', () => {
      const unidas = exigenciasDe([RUBRICA, []]);
      expect(unidas.reduce((s, c) => s + c.peso, 0)).toBeCloseTo(100, 5);
    });

    it('ningun ejercicio con criterios da lista vacia, no una division por cero', () => {
      expect(exigenciasDe([])).toEqual([]);
      expect(exigenciasDe([[], []])).toEqual([]);
    });
  });
});
