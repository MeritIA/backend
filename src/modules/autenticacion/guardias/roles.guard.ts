import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Rol, rolTienePermiso, type Permiso } from '../dominio/rol.js';
import type { UsuarioAutenticado } from './autenticacion.guard.js';

export const ROLES_REQUERIDOS = 'roles_requeridos';
export const PERMISO_REQUERIDO = 'permiso_requerido';

/** Exige uno de estos roles. */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES_REQUERIDOS, roles);

/**
 * Exige un permiso de la matriz, en vez de nombrar roles sueltos.
 *
 * Es lo preferible: si manana un reclutador puede eliminar vacantes, se cambia
 * la matriz en un sitio y no hay que buscar decoradores por los controladores.
 */
export const RequierePermiso = (permiso: Permiso) => SetMetadata(PERMISO_REQUERIDO, permiso);

/**
 * Autorizacion por rol.
 *
 * Criterio de aceptacion del paquete 2.1: "un candidato no puede acceder a
 * recursos de reclutador ni de administrador".
 *
 * ESTO NO ES TODA LA AUTORIZACION. Cubre la capa de rol; la de **recurso** —que
 * un candidato solo vea SU entrega— depende del dato concreto y se comprueba en
 * cada servicio. El encuadre pide autorizacion en tres niveles: endpoint,
 * recurso y operacion. Este guardia resuelve el primero y el tercero.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger('Autorizacion');

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permiso = this.reflector.getAllAndOverride<Permiso | undefined>(PERMISO_REQUERIDO, [
      context.getHandler(),
      context.getClass(),
    ]);
    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLES_REQUERIDOS, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sin exigencia declarada, basta estar autenticado: de eso ya se encargo el
    // guardia anterior.
    if (!permiso && (!roles || roles.length === 0)) return true;

    const peticion = context.switchToHttp().getRequest<{
      usuario?: UsuarioAutenticado;
      url?: string;
      ip?: string;
    }>();
    const usuario = peticion.usuario;

    if (!usuario) {
      // Solo puede pasar si alguien pone este guardia sin el de autenticacion
      // delante. Se niega en vez de dejar pasar.
      this.rechazar('sin_usuario_en_la_peticion', peticion, undefined);
      throw new ForbiddenException('No tienes permiso para esta operacion.');
    }

    const autorizado = permiso
      ? rolTienePermiso(usuario.rol, permiso)
      : (roles ?? []).includes(usuario.rol);

    if (!autorizado) {
      this.rechazar(permiso ?? (roles ?? []).join(','), peticion, usuario);
      throw new ForbiddenException('No tienes permiso para esta operacion.');
    }

    return true;
  }

  private rechazar(
    exigido: string,
    peticion: { url?: string; ip?: string },
    usuario: UsuarioAutenticado | undefined,
  ): void {
    this.logger.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType: 'authorization_denied',
        userId: usuario?.id ?? '',
        ip: peticion.ip ?? '',
        path: peticion.url ?? '',
        message: 'Autorizacion denegada',
        metadata: { rolDelUsuario: usuario?.rol ?? 'ninguno', exigido },
      }),
    );
  }
}
