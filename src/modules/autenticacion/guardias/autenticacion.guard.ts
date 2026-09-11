import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AutenticacionService } from '../autenticacion.service.js';
import { PasetoService, TokenRechazadoError } from '../servicios/paseto.service.js';
import type { Rol } from '../dominio/rol.js';

/** Marca un endpoint como accesible sin token. */
export const PUBLICO = 'endpoint_publico';
export const Publico = () => SetMetadata(PUBLICO, true);

export interface UsuarioAutenticado {
  readonly id: string;
  readonly rol: Rol;
}

/**
 * Exige un token de acceso valido.
 *
 * Se registra de forma global: **un endpoint esta protegido salvo que diga lo
 * contrario** con @Publico(). Al reves —proteger solo lo que se decore— basta
 * olvidar un decorador para dejar un endpoint abierto, y ese olvido no se nota
 * en ninguna prueba que compruebe el camino feliz.
 *
 * Criterio de aceptacion del paquete 2.1: "un token expirado o manipulado es
 * rechazado con 401".
 */
@Injectable()
export class AutenticacionGuard implements CanActivate {
  private readonly logger = new Logger('Autenticacion');

  constructor(
    private readonly reflector: Reflector,
    private readonly paseto: PasetoService,
    private readonly autenticacion: AutenticacionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(PUBLICO, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (esPublico) return true;

    const peticion = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      url?: string;
      ip?: string;
      usuario?: UsuarioAutenticado;
    }>();

    const token = extraerToken(peticion.headers.authorization);
    if (!token) {
      this.registrarFallo('token_ausente', peticion);
      throw new UnauthorizedException('Falta el token de acceso.');
    }

    try {
      const contenido = await this.paseto.verificar(token, 'acceso');
      // Se consulta la base de datos: un token sigue siendo valido
      // criptograficamente despues de desactivar la cuenta.
      const usuario = await this.autenticacion.usuarioDeToken(contenido.sub, contenido.iat);
      peticion.usuario = { id: usuario.id, rol: usuario.rol };
      return true;
    } catch (e) {
      if (e instanceof TokenRechazadoError) {
        this.registrarFallo(e.motivo, peticion);
        // El motivo va al log, no a la respuesta: distinguir "vencido" de
        // "firma invalida" le dice a quien prueba si acerto con la clave.
        throw new UnauthorizedException('Token de acceso invalido o vencido.');
      }
      throw e;
    }
  }

  private registrarFallo(motivo: string, peticion: { url?: string; ip?: string }): void {
    this.logger.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType: 'auth_failure',
        ip: peticion.ip ?? '',
        path: peticion.url ?? '',
        message: 'Acceso rechazado',
        metadata: { motivo },
      }),
    );
  }
}

/** Acepta `Bearer <token>`, sin distinguir mayusculas en el esquema. */
export function extraerToken(cabecera: string | string[] | undefined): string | null {
  if (typeof cabecera !== 'string') return null;
  const [esquema, valor, ...resto] = cabecera.trim().split(/\s+/);
  if (resto.length > 0) return null;
  if (esquema?.toLowerCase() !== 'bearer' || !valor) return null;
  return valor;
}
