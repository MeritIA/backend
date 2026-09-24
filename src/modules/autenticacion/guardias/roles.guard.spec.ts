import { ForbiddenException, Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';
import { PERMISOS, Rol, rolTienePermiso, type Permiso } from '../dominio/rol.js';

function contexto(usuario?: { id: string; rol: Rol }): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ usuario, url: '/api/v1/algo', ip: '203.0.113.9' }),
    }),
  } as unknown as ExecutionContext;
}

function guardConMetadatos(metadatos: Record<string, unknown>): RolesGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
    (clave: unknown) => metadatos[clave as string],
  );
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  describe('criterio: un candidato no accede a recursos de reclutador ni de administrador', () => {
    it('bloquea a un candidato en un endpoint de reclutador', () => {
      const guard = guardConMetadatos({ roles_requeridos: [Rol.Reclutador] });
      expect(() => guard.canActivate(contexto({ id: 'u1', rol: Rol.Candidato }))).toThrow(
        ForbiddenException,
      );
    });

    it('bloquea a un candidato en un endpoint de administrador', () => {
      const guard = guardConMetadatos({ roles_requeridos: [Rol.Administrador] });
      expect(() => guard.canActivate(contexto({ id: 'u1', rol: Rol.Candidato }))).toThrow(
        ForbiddenException,
      );
    });

    it('bloquea a un reclutador en un endpoint solo de administrador', () => {
      const guard = guardConMetadatos({ roles_requeridos: [Rol.Administrador] });
      expect(() => guard.canActivate(contexto({ id: 'u2', rol: Rol.Reclutador }))).toThrow(
        ForbiddenException,
      );
    });

    it('deja pasar al rol correcto', () => {
      const guard = guardConMetadatos({ roles_requeridos: [Rol.Reclutador, Rol.Administrador] });
      expect(guard.canActivate(contexto({ id: 'u2', rol: Rol.Reclutador }))).toBe(true);
      expect(guard.canActivate(contexto({ id: 'u3', rol: Rol.Administrador }))).toBe(true);
    });
  });

  describe('por permiso de la matriz', () => {
    it('respeta la matriz', () => {
      const guard = guardConMetadatos({ permiso_requerido: 'vacantes:crear' satisfies Permiso });
      expect(guard.canActivate(contexto({ id: 'u2', rol: Rol.Reclutador }))).toBe(true);
      expect(() => guard.canActivate(contexto({ id: 'u1', rol: Rol.Candidato }))).toThrow(
        ForbiddenException,
      );
    });

    it('solo un administrador elimina vacantes', () => {
      const guard = guardConMetadatos({ permiso_requerido: 'vacantes:eliminar' satisfies Permiso });
      expect(guard.canActivate(contexto({ id: 'u3', rol: Rol.Administrador }))).toBe(true);
      for (const rol of [Rol.Candidato, Rol.Reclutador]) {
        expect(() => guard.canActivate(contexto({ id: 'x', rol }))).toThrow(ForbiddenException);
      }
    });

    it('solo un candidato crea entregas', () => {
      const guard = guardConMetadatos({ permiso_requerido: 'entregas:crear' satisfies Permiso });
      expect(guard.canActivate(contexto({ id: 'u1', rol: Rol.Candidato }))).toBe(true);
      for (const rol of [Rol.Reclutador, Rol.Administrador]) {
        expect(() => guard.canActivate(contexto({ id: 'x', rol }))).toThrow(ForbiddenException);
      }
    });
  });

  describe('casos limite', () => {
    it('sin exigencia declarada deja pasar: de autenticar ya se encargo el otro guardia', () => {
      const guard = guardConMetadatos({});
      expect(guard.canActivate(contexto({ id: 'u1', rol: Rol.Candidato }))).toBe(true);
    });

    it('niega si no hay usuario en la peticion', () => {
      // Solo ocurre si alguien pone este guardia sin el de autenticacion
      // delante. Se niega en vez de dejar pasar.
      const guard = guardConMetadatos({ roles_requeridos: [Rol.Candidato] });
      expect(() => guard.canActivate(contexto(undefined))).toThrow(ForbiddenException);
    });

    it('una lista de roles vacia no abre el endpoint a cualquiera con permiso exigido', () => {
      const guard = guardConMetadatos({
        roles_requeridos: [],
        permiso_requerido: 'usuarios:administrar' satisfies Permiso,
      });
      expect(() => guard.canActivate(contexto({ id: 'u1', rol: Rol.Candidato }))).toThrow(
        ForbiddenException,
      );
    });
  });
});

describe('matriz de permisos', () => {
  it('ningun permiso queda sin rol asignado', () => {
    for (const [permiso, roles] of Object.entries(PERMISOS)) {
      expect(roles.length, `"${permiso}" no tiene ningun rol`).toBeGreaterThan(0);
    }
  });

  it('un candidato no tiene ningun permiso de administracion', () => {
    const deAdministracion: Permiso[] = [
      'usuarios:administrar',
      'vacantes:eliminar',
      'evaluaciones:reintentar',
    ];
    for (const p of deAdministracion) {
      expect(rolTienePermiso(Rol.Candidato, p), p).toBe(false);
      expect(rolTienePermiso(Rol.Reclutador, p), p).toBe(false);
    }
  });

  it('un candidato solo puede leer lo suyo, nunca lo de una vacante entera', () => {
    expect(rolTienePermiso(Rol.Candidato, 'entregas:leerPropias')).toBe(true);
    expect(rolTienePermiso(Rol.Candidato, 'entregas:leerDeLaVacante')).toBe(false);
    expect(rolTienePermiso(Rol.Candidato, 'evaluaciones:leerDeLaVacante')).toBe(false);
    expect(rolTienePermiso(Rol.Candidato, 'reportes:verDeLaVacante')).toBe(false);
  });
});
