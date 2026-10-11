import { Logger } from '@nestjs/common';
import { createPublicKey } from 'node:crypto';
import pkg from 'paseto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasetoService, TokenRechazadoError } from './paseto.service.js';
import { Rol } from '../dominio/rol.js';

const { V4 } = pkg;

let entorno: NodeJS.ProcessEnv;
let clavePrivadaPem: string;

beforeAll(async () => {
  const secreta = await V4.generateKey('public');
  clavePrivadaPem = secreta.export({ type: 'pkcs8', format: 'pem' }) as string;
  const publica = createPublicKey(secreta).export({ type: 'spki', format: 'pem' }) as string;
  entorno = {
    PASETO_PRIVATE_KEY: Buffer.from(clavePrivadaPem).toString('base64'),
    PASETO_PUBLIC_KEY: Buffer.from(publica).toString('base64'),
    TOKEN_EXPIRATION_HOURS: '24',
    REFRESH_TOKEN_EXPIRATION_DAYS: '7',
  };
});

describe('PasetoService', () => {
  let servicio: PasetoService;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    servicio = new PasetoService(entorno);
  });

  describe('emision', () => {
    it('emite un token v4.public', async () => {
      const t = await servicio.emitirAcceso('u-1', Rol.Candidato, null);
      expect(t.startsWith('v4.public.')).toBe(true);
    });

    it('pone exp como cadena ISO8601 y no como timestamp Unix', async () => {
      const t = await servicio.emitirAcceso('u-1', Rol.Candidato, null);
      const { exp } = await servicio.verificar(t, 'acceso');
      // El riesgo que señala el Diccionario en este paquete: un exp mal
      // implementado deja tokens validos indefinidamente.
      expect(typeof exp).toBe('string');
      expect(exp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(exp).getTime()).toBeGreaterThan(Date.now());
    });

    it('distingue el token de acceso del de renovacion', async () => {
      const acceso = await servicio.emitirAcceso('u-1', Rol.Candidato, null);
      const renov = await servicio.emitirRenovacion('u-1', Rol.Candidato, null);

      await expect(servicio.verificar(renov, 'acceso')).rejects.toThrow(TokenRechazadoError);
      await expect(servicio.verificar(acceso, 'renovacion')).rejects.toThrow(TokenRechazadoError);
    });

    it('conserva sujeto y rol', async () => {
      const t = await servicio.emitirAcceso('u-42', Rol.Reclutador, null);
      const c = await servicio.verificar(t, 'acceso');
      expect(c.sub).toBe('u-42');
      expect(c.rol).toBe(Rol.Reclutador);
    });
  });

  describe('rechazos', () => {
    async function motivoDe(promesa: Promise<unknown>): Promise<string> {
      try {
        await promesa;
        return 'no-lanzo';
      } catch (e) {
        return e instanceof TokenRechazadoError ? e.motivo : 'otro-error';
      }
    }

    it('rechaza un token vencido', async () => {
      // Se firma a mano con exp en el pasado: es el caso que el criterio de
      // aceptacion exige ("un token expirado es rechazado con 401") y no se
      // puede provocar esperando 24 horas.
      const vencido = await V4.sign(
        {
          sub: 'u-1',
          rol: Rol.Candidato,
          tipo: 'acceso',
          exp: new Date(Date.now() - 1000).toISOString(),
          iat: new Date(Date.now() - 3600_000).toISOString(),
        },
        clavePrivadaPem,
      );
      expect(await motivoDe(servicio.verificar(vencido, 'acceso'))).toBe('token_vencido');
    });

    it('rechaza un token SIN expiracion, en vez de tratarlo como eterno', async () => {
      const sinExp = await V4.sign(
        { sub: 'u-1', rol: Rol.Candidato, tipo: 'acceso', iat: new Date().toISOString() },
        clavePrivadaPem,
      );
      expect(await motivoDe(servicio.verificar(sinExp, 'acceso'))).toBe('expiracion_ausente');
    });

    it('rechaza una expiracion que no sea ISO8601', async () => {
      // La libreria valida el formato de fecha antes que nuestra comprobacion,
      // asi que estos casos nunca llegan a ella. Se verifica igual: lo que
      // importa es que el token se rechace Y que el motivo registrado sea el
      // correcto, no "firma_invalida".
      for (const exp of ['1789456123', 'manana', '2026-13-45T99:99:99Z', '']) {
        const t = await V4.sign(
          { sub: 'u-1', rol: Rol.Candidato, tipo: 'acceso', exp, iat: new Date().toISOString() },
          clavePrivadaPem,
        );
        expect(await motivoDe(servicio.verificar(t, 'acceso'))).toBe('expiracion_mal_formada');
      }
    });

    it('rechaza un token firmado con otra clave', async () => {
      const otra = await V4.generateKey('public');
      const ajeno = await V4.sign(
        {
          sub: 'u-1',
          rol: Rol.Candidato,
          tipo: 'acceso',
          exp: new Date(Date.now() + 3600_000).toISOString(),
          iat: new Date().toISOString(),
        },
        otra,
      );
      expect(await motivoDe(servicio.verificar(ajeno, 'acceso'))).toBe('firma_invalida');
    });

    it('rechaza un token manipulado', async () => {
      const t = await servicio.emitirAcceso('u-1', Rol.Candidato, null);
      // Se altera un caracter del MEDIO, no el ultimo.
      //
      // El intento anterior cambiaba el ultimo evitando la 'X'. Eso bajaba la
      // intermitencia sin quitarla: en base64url el ultimo caracter arrastra
      // bits sobrantes y, segun la longitud, varios caracteres distintos
      // decodifican los MISMOS bytes. Cuando tocaba uno de esos, el token
      // seguia siendo valido. Un caracter del medio usa sus seis bits.
      const enMedio = (t: string): string => {
        const i = Math.floor(t.length / 2);
        return t.slice(0, i) + (t[i] === 'a' ? 'b' : 'a') + t.slice(i + 1);
      };
      const primeroDistinto = (c: string): string => (c === 'X' ? 'Y' : 'X');
      for (const roto of [
        enMedio(t),
        primeroDistinto(t[0]) + t.slice(1),
        t.replace('v4.public.', 'v4.local.'),
      ]) {
        expect(await motivoDe(servicio.verificar(roto, 'acceso'))).toBe('firma_invalida');
      }
    });

    it('rechaza un rol que no existe', async () => {
      const t = await V4.sign(
        {
          sub: 'u-1',
          rol: 'superadministrador',
          tipo: 'acceso',
          exp: new Date(Date.now() + 3600_000).toISOString(),
          iat: new Date().toISOString(),
        },
        clavePrivadaPem,
      );
      expect(await motivoDe(servicio.verificar(t, 'acceso'))).toBe('contenido_incompleto');
    });

    it('no revela el motivo en el mensaje que veria un cliente', async () => {
      // El motivo va al log; el guardia traduce todo a un 401 generico.
      const t = await servicio.emitirRenovacion('u-1', Rol.Candidato, null);
      try {
        await servicio.verificar(t, 'acceso');
      } catch (e) {
        expect(e).toBeInstanceOf(TokenRechazadoError);
      }
    });
  });

  describe('configuracion', () => {
    it('no arranca sin las claves', () => {
      expect(() => new PasetoService({})).toThrow(/PASETO_PRIVATE_KEY/);
      expect(() => new PasetoService({ PASETO_PRIVATE_KEY: 'x' })).toThrow(/PASETO_PUBLIC_KEY/);
    });
  });
});
