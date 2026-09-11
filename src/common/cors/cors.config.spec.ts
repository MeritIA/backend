import { describe, expect, it } from 'vitest';
import { construirOpcionesCors, origenesPermitidos } from './cors.config.js';

/** Ejecuta la funcion `origin` de las opciones y devuelve si permitio el origen. */
function permite(origen: string | undefined, entorno: string, configurados?: string): boolean {
  const opciones = construirOpcionesCors(entorno, configurados);
  let resultado = false;
  const origin = opciones.origin as (
    o: string | undefined,
    cb: (e: Error | null, permitido?: boolean) => void,
  ) => void;
  origin(origen, (_e, permitido) => {
    resultado = permitido === true;
  });
  return resultado;
}

describe('politica de CORS', () => {
  describe('produccion', () => {
    const CONF = 'https://meritia.app,capacitor://localhost';

    it('permite el dominio web configurado', () => {
      expect(permite('https://meritia.app', 'production', CONF)).toBe(true);
    });

    it('permite el esquema nativo de la APK', () => {
      expect(permite('capacitor://localhost', 'production', CONF)).toBe(true);
    });

    it('rechaza un origen desconocido', () => {
      expect(permite('https://sitio-malicioso.example', 'production', CONF)).toBe(false);
    });

    it('no cuela un origen por parecerse al permitido', () => {
      for (const impostor of [
        'https://meritia.app.malicioso.example',
        'https://meritia-app.example',
        'http://meritia.app',
      ]) {
        expect(permite(impostor, 'production', CONF)).toBe(false);
      }
    });

    it('no arrastra los origenes de desarrollo a produccion', () => {
      expect(permite('http://localhost:4200', 'production', CONF)).toBe(false);
    });

    it('sin ALLOWED_ORIGINS rechaza todo en vez de abrirse', () => {
      expect(permite('https://meritia.app', 'production', '')).toBe(false);
      expect(origenesPermitidos('production', '')).toHaveLength(0);
    });
  });

  describe('fuera de produccion', () => {
    it('permite los origenes de desarrollo', () => {
      for (const o of [
        'http://localhost:4200',
        'http://localhost:8100',
        'capacitor://localhost',
        'ionic://localhost',
      ]) {
        expect(permite(o, 'development')).toBe(true);
      }
    });

    it('SIGUE rechazando un origen desconocido', () => {
      // Esta es la desviacion deliberada respecto del ejemplo del Plan de
      // Seguridad, que permite cualquier origen cuando NODE_ENV no es
      // production. La lista blanca rige en todos los entornos.
      expect(permite('https://sitio-malicioso.example', 'development')).toBe(false);
      expect(permite('https://sitio-malicioso.example', 'test')).toBe(false);
      expect(permite('https://sitio-malicioso.example', undefined)).toBe(false);
    });

    it('suma lo configurado a los origenes de desarrollo', () => {
      expect(
        permite('https://pruebas.meritia.app', 'development', 'https://pruebas.meritia.app'),
      ).toBe(true);
      expect(permite('http://localhost:4200', 'development', 'https://pruebas.meritia.app')).toBe(
        true,
      );
    });
  });

  describe('peticiones sin cabecera Origin', () => {
    it('se permiten (APK nativa, Postman, servidor a servidor)', () => {
      expect(permite(undefined, 'production', 'https://meritia.app')).toBe(true);
    });
  });

  describe('opciones', () => {
    it('expone Retry-After para que el cliente lea el limite de peticiones', () => {
      expect(construirOpcionesCors('production', 'https://meritia.app').exposedHeaders).toContain(
        'Retry-After',
      );
    });

    it('permite credenciales, que es lo que exige la cookie HttpOnly del token', () => {
      expect(construirOpcionesCors('production', 'https://meritia.app').credentials).toBe(true);
    });
  });
});
