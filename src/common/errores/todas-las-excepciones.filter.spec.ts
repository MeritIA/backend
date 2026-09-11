import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodasLasExcepcionesFilter } from './todas-las-excepciones.filter.js';
import type { RespuestaError } from './respuesta-error.js';

function hostFalso(url = '/api/v1/algo', method = 'GET') {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url, method, ip: '203.0.113.7' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, cuerpo: () => json.mock.calls[0]?.[0] as RespuestaError };
}

describe('TodasLasExcepcionesFilter', () => {
  let filtro: TodasLasExcepcionesFilter;

  beforeEach(() => {
    filtro = new TodasLasExcepcionesFilter();
    // El filtro registra por el Logger de Nest, que escribe directo a la
    // salida estandar. Se silencia: unas pruebas ruidosas esconden los fallos
    // de verdad entre el ruido.
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('no filtra nada del interior del sistema', () => {
    it('un error inesperado NO devuelve el mensaje original', () => {
      const { host, cuerpo } = hostFalso();
      filtro.catch(
        new Error('connect ECONNREFUSED 10.0.3.14:5432 database "meritia" role "postgres"'),
        host,
      );

      const r = cuerpo();
      expect(r.estado).toBe(500);
      expect(r.codigo).toBe('ERROR_INTERNO');
      expect(JSON.stringify(r)).not.toMatch(/ECONNREFUSED|10\.0\.3\.14|5432|postgres/);
    });

    it('un error inesperado NO devuelve la traza de pila', () => {
      const { host, cuerpo } = hostFalso();
      const e = new Error('fallo');
      e.stack = 'Error: fallo\n    at Objeto.metodo (/app/dist/modules/secreto.js:42:15)';
      filtro.catch(e, host);

      const serializado = JSON.stringify(cuerpo());
      expect(serializado).not.toContain('at Objeto.metodo');
      expect(serializado).not.toContain('/app/dist');
      expect(Object.keys(cuerpo())).not.toContain('stack');
    });

    it('un fallo de base de datos no delata el motor ni la tabla', () => {
      const { host, cuerpo } = hostFalso();
      filtro.catch(
        Object.assign(
          new Error('duplicate key value violates unique constraint "usuarios_email_key"'),
          {
            code: '23505',
          },
        ),
        host,
      );
      expect(JSON.stringify(cuerpo())).not.toMatch(/usuarios_email_key|23505|unique constraint/);
    });
  });

  describe('respuestas previstas por el propio codigo', () => {
    it('conserva el mensaje de una HttpException lanzada a proposito', () => {
      const { host, cuerpo } = hostFalso();
      filtro.catch(new ForbiddenException('No puedes ver la entrega de otro candidato.'), host);

      expect(cuerpo().estado).toBe(403);
      expect(cuerpo().codigo).toBe('PROHIBIDO');
      expect(cuerpo().mensaje).toBe('No puedes ver la entrega de otro candidato.');
    });

    it('traduce el estado a un codigo estable', () => {
      const casos: [number, string][] = [
        [HttpStatus.UNAUTHORIZED, 'NO_AUTENTICADO'],
        [HttpStatus.FORBIDDEN, 'PROHIBIDO'],
        [HttpStatus.NOT_FOUND, 'NO_ENCONTRADO'],
        [HttpStatus.CONFLICT, 'CONFLICTO'],
        [HttpStatus.TOO_MANY_REQUESTS, 'LIMITE_DE_PETICIONES_EXCEDIDO'],
      ];
      for (const [estado, codigo] of casos) {
        const { host, cuerpo } = hostFalso();
        filtro.catch(new HttpException('x', estado), host);
        expect(cuerpo().codigo).toBe(codigo);
      }
    });
  });

  describe('errores de validacion de DTO', () => {
    it('devuelve 400 con el detalle agrupado por campo', () => {
      const { host, cuerpo } = hostFalso('/api/v1/autenticacion/registro', 'POST');
      filtro.catch(
        new BadRequestException({
          message: ['email must be an email', 'password is too weak', 'email should not be empty'],
          error: 'Bad Request',
          statusCode: 400,
        }),
        host,
      );

      const r = cuerpo();
      expect(r.estado).toBe(400);
      expect(r.codigo).toBe('VALIDACION_FALLIDA');
      expect(r.errores).toHaveLength(2);
      expect(r.errores?.find((e) => e.campo === 'email')?.problemas).toHaveLength(2);
    });
  });

  describe('forma de la respuesta', () => {
    it('siempre trae los mismos campos', () => {
      const { host, cuerpo } = hostFalso();
      filtro.catch(new Error('x'), host);
      for (const campo of ['estado', 'codigo', 'mensaje', 'momento', 'ruta', 'referencia']) {
        expect(cuerpo()).toHaveProperty(campo);
      }
    });

    it('la referencia es distinta en cada error, para cruzarla con el log', () => {
      const a = hostFalso();
      const b = hostFalso();
      filtro.catch(new Error('x'), a.host);
      filtro.catch(new Error('x'), b.host);
      expect(a.cuerpo().referencia).not.toBe(b.cuerpo().referencia);
    });
  });
});
