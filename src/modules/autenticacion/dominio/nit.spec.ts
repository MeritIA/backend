import { describe, expect, it } from 'vitest';
import { digitoDeVerificacion, esNitValido, normalizarNit } from './nit.js';

/**
 * Los dos casos que anclan el algoritmo son NIT publicos y verificables, no
 * numeros inventados: con numeros inventados la prueba solo comprobaria que el
 * codigo hace lo que el codigo hace.
 *
 * - 890903938-8: el resto de la division es 3, asi que el digito es 11 - 3.
 * - 899999068-1: el resto es 1, y entonces el digito ES el resto. Es la rama
 *   que una implementacion descuidada confunde con 11 - 1 = 10.
 */
describe('digito de verificacion del NIT', () => {
  it('calcula el digito de un NIT publico conocido', () => {
    expect(digitoDeVerificacion('890903938')).toBe(8);
  });

  it('cuando el resto es menor que 2, el digito ES el resto', () => {
    expect(digitoDeVerificacion('899999068')).toBe(1);
  });

  it('no devuelve numero para lo que no es una base de NIT', () => {
    // Devolver 0 o cualquier otro numero haria pasar por valido algo que no se
    // pudo calcular.
    expect(digitoDeVerificacion('')).toBeNull();
    expect(digitoDeVerificacion('1234567')).toBeNull();
    expect(digitoDeVerificacion('1234567890123456')).toBeNull();
    expect(digitoDeVerificacion('89090393a')).toBeNull();
  });

  it('acepta las ocho y las quince posiciones de la serie', () => {
    expect(digitoDeVerificacion('12345678')).not.toBeNull();
    expect(digitoDeVerificacion('123456789012345')).not.toBeNull();
  });
});

describe('normalizacion del NIT', () => {
  it('quita los puntos y los espacios con los que se escribe', () => {
    expect(normalizarNit('890.903.938-8')).toBe('890903938-8');
    expect(normalizarNit(' 890 903 938-8 ')).toBe('890903938-8');
  });

  it('no toca el guion, que separa la base del digito', () => {
    expect(normalizarNit('890903938-8')).toBe('890903938-8');
  });
});

describe('validacion del NIT completo', () => {
  it('acepta un NIT correcto, con y sin puntos', () => {
    expect(esNitValido('890903938-8')).toBe(true);
    expect(esNitValido('890.903.938-8')).toBe(true);
    expect(esNitValido('899999068-1')).toBe(true);
  });

  it('rechaza el digito de verificacion equivocado', () => {
    // El caso real: alguien copia el NIT y se equivoca en el ultimo numero.
    expect(esNitValido('890903938-7')).toBe(false);
    expect(esNitValido('890903938-0')).toBe(false);
  });

  it('rechaza un digito transpuesto en la base', () => {
    // 890903938 -> 890909338. El digito de verificacion deja de cuadrar, que es
    // justo para lo que existe.
    expect(esNitValido('890909338-8')).toBe(false);
  });

  it('exige el digito: sin el no hay nada que comprobar', () => {
    expect(esNitValido('890903938')).toBe(false);
  });

  it('rechaza lo que no es un NIT', () => {
    expect(esNitValido('')).toBe(false);
    expect(esNitValido('no-es-un-nit')).toBe(false);
    expect(esNitValido('890903938-')).toBe(false);
    expect(esNitValido('890903938-88')).toBe(false);
    expect(esNitValido('-8')).toBe(false);
  });
});
