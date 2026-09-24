import { describe, expect, it } from 'vitest';
import { ContrasenasService, normalizarCorreo } from './contrasenas.service.js';

describe('ContrasenasService', () => {
  const servicio = new ContrasenasService();

  describe('hashing de contrasenas', () => {
    it('usa argon2id, que es la recomendacion de OWASP', async () => {
      const h = await servicio.cifrar('una-frase-larga-y-dificil');
      expect(h.split('$')[1]).toBe('argon2id');
    });

    it('nunca guarda la contrasena en claro', async () => {
      const h = await servicio.cifrar('mi-contrasena-secreta');
      expect(h).not.toContain('mi-contrasena-secreta');
    });

    it('el mismo texto produce hashes distintos, por la sal aleatoria', async () => {
      const [a, b] = await Promise.all([servicio.cifrar('igual'), servicio.cifrar('igual')]);
      expect(a).not.toBe(b);
      expect(await servicio.coincide('igual', a)).toBe(true);
      expect(await servicio.coincide('igual', b)).toBe(true);
    });

    it('verifica correctamente', async () => {
      const h = await servicio.cifrar('la-buena');
      expect(await servicio.coincide('la-buena', h)).toBe(true);
      expect(await servicio.coincide('la-mala', h)).toBe(false);
      expect(await servicio.coincide('', h)).toBe(false);
    });

    it('devuelve false ante un hash corrupto en vez de lanzar', async () => {
      // Un fallo aqui no debe distinguirse de una contrasena equivocada: esa
      // diferencia le diria a quien prueba que la cuenta existe.
      for (const malo of ['', 'no-es-un-hash', '$argon2id$roto', '$2b$10$bcryptDistinto']) {
        expect(await servicio.coincide('x', malo)).toBe(false);
      }
    });

    it('admite contrasenas largas, sin el tope de 72 bytes de bcrypt', async () => {
      const larga = 'a'.repeat(128);
      expect(await servicio.coincide(larga, await servicio.cifrar(larga))).toBe(true);
      expect(await servicio.coincide('a'.repeat(127), await servicio.cifrar(larga))).toBe(false);
    });
  });

  describe('hash de busqueda del correo', () => {
    it('es deterministico: sin eso no habria forma de iniciar sesion', () => {
      expect(servicio.hashDeCorreo('ana@x.com')).toBe(servicio.hashDeCorreo('ana@x.com'));
    });

    it('normaliza mayusculas y espacios', () => {
      const esperado = servicio.hashDeCorreo('ana@x.com');
      expect(servicio.hashDeCorreo('  Ana@X.COM  ')).toBe(esperado);
    });

    it('correos distintos dan hashes distintos', () => {
      expect(servicio.hashDeCorreo('ana@x.com')).not.toBe(servicio.hashDeCorreo('ana@y.com'));
    });

    it('mide 64 caracteres hexadecimales, como exige la columna char(64)', () => {
      expect(servicio.hashDeCorreo('ana@x.com')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('normalizarCorreo', () => {
    it('recorta y pasa a minusculas', () => {
      expect(normalizarCorreo('  Hola@Ejemplo.COM ')).toBe('hola@ejemplo.com');
    });
  });

  describe('comparacion en tiempo constante', () => {
    it('compara bien', () => {
      expect(ContrasenasService.sonIguales('abc', 'abc')).toBe(true);
      expect(ContrasenasService.sonIguales('abc', 'abd')).toBe(false);
      expect(ContrasenasService.sonIguales('abc', 'abcd')).toBe(false);
    });
  });
});
