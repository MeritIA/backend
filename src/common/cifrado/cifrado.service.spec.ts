import { describe, expect, it } from 'vitest';
import {
  CifradoService,
  ClaveDeCifradoInvalidaError,
  DescifradoFallidoError,
  leerClaveDeCifrado,
} from './cifrado.service.js';

const CLAVE = 'a'.repeat(64);
const OTRA_CLAVE = 'b'.repeat(64);

describe('CifradoService', () => {
  const servicio = new CifradoService(CLAVE);

  describe('ida y vuelta', () => {
    it('descifra lo que cifro', () => {
      const original = 'CC 1.020.123.456';
      expect(servicio.descifrar(servicio.cifrar(original))).toBe(original);
    });

    it('conserva acentos, enes y emoji', () => {
      const original = 'Hildebrando Peña Quezada — año 2026 ✅';
      expect(servicio.descifrar(servicio.cifrar(original))).toBe(original);
    });

    it('admite la cadena vacia', () => {
      expect(servicio.descifrar(servicio.cifrar(''))).toBe('');
    });

    it('admite textos largos', () => {
      const original = 'x'.repeat(20_000);
      expect(servicio.descifrar(servicio.cifrar(original))).toBe(original);
    });
  });

  describe('formato de almacenamiento', () => {
    it('guarda iv:authTag:ciphertext en base64', () => {
      const partes = servicio.cifrar('dato').split(':');
      expect(partes).toHaveLength(3);
      expect(Buffer.from(partes[0], 'base64')).toHaveLength(12);
      expect(Buffer.from(partes[1], 'base64')).toHaveLength(16);
    });

    it('no deja el texto plano a la vista', () => {
      expect(servicio.cifrar('clave-api-secreta')).not.toContain('clave-api-secreta');
    });
  });

  describe('no determinismo', () => {
    it('cifra el mismo valor distinto cada vez', () => {
      // Si dos filas con el mismo dato produjeran el mismo cifrado, se podria
      // deducir que coinciden sin descifrar nada.
      const a = servicio.cifrar('mismo-valor');
      const b = servicio.cifrar('mismo-valor');
      expect(a).not.toBe(b);
      expect(servicio.descifrar(a)).toBe(servicio.descifrar(b));
    });
  });

  describe('deteccion de manipulacion', () => {
    it('rechaza un ciphertext alterado', () => {
      const [iv, tag, cifrado] = servicio.cifrar('saldo: 100').split(':');
      const bytes = Buffer.from(cifrado, 'base64');
      bytes[0] ^= 0xff;
      expect(() => servicio.descifrar(`${iv}:${tag}:${bytes.toString('base64')}`)).toThrow(
        DescifradoFallidoError,
      );
    });

    it('rechaza una etiqueta de autenticacion alterada', () => {
      const [iv, tag, cifrado] = servicio.cifrar('dato').split(':');
      const bytes = Buffer.from(tag, 'base64');
      bytes[0] ^= 0xff;
      expect(() => servicio.descifrar(`${iv}:${bytes.toString('base64')}:${cifrado}`)).toThrow(
        DescifradoFallidoError,
      );
    });

    it('rechaza un IV alterado', () => {
      const [iv, tag, cifrado] = servicio.cifrar('dato').split(':');
      const bytes = Buffer.from(iv, 'base64');
      bytes[0] ^= 0xff;
      expect(() => servicio.descifrar(`${bytes.toString('base64')}:${tag}:${cifrado}`)).toThrow(
        DescifradoFallidoError,
      );
    });

    it('rechaza un dato cifrado con otra clave', () => {
      const otro = new CifradoService(OTRA_CLAVE);
      expect(() => servicio.descifrar(otro.cifrar('dato'))).toThrow(DescifradoFallidoError);
    });

    it('rechaza formatos que no son iv:authTag:ciphertext', () => {
      for (const malo of ['', 'texto-plano', 'a:b', 'a:b:c:d']) {
        expect(() => servicio.descifrar(malo)).toThrow(DescifradoFallidoError);
      }
    });

    it('no filtra el detalle interno del fallo', () => {
      try {
        servicio.descifrar(new CifradoService(OTRA_CLAVE).cifrar('x'));
        expect.unreachable('deberia haber lanzado');
      } catch (e) {
        expect((e as Error).message).not.toMatch(/unable to authenticate|bad decrypt|openssl/i);
      }
    });
  });

  describe('validacion de la clave', () => {
    it('exige que ENCRYPTION_KEY exista', () => {
      expect(() => leerClaveDeCifrado(undefined)).toThrow(ClaveDeCifradoInvalidaError);
      expect(() => leerClaveDeCifrado('')).toThrow(ClaveDeCifradoInvalidaError);
    });

    it('exige 64 caracteres hexadecimales', () => {
      for (const mala of ['abc', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64)]) {
        expect(() => leerClaveDeCifrado(mala)).toThrow(ClaveDeCifradoInvalidaError);
      }
    });

    it('acepta mayusculas y minusculas', () => {
      expect(leerClaveDeCifrado('A'.repeat(64))).toHaveLength(32);
    });
  });

  describe('comparacion en tiempo constante', () => {
    it('compara correctamente', () => {
      expect(CifradoService.sonIguales('token', 'token')).toBe(true);
      expect(CifradoService.sonIguales('token', 'otro!')).toBe(false);
      expect(CifradoService.sonIguales('token', 'tokens')).toBe(false);
    });
  });
});
