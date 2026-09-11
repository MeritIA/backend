import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';

/**
 * ThrottlerGuard que ademas registra el bloqueo.
 *
 * Plan de Seguridad §4.4 pide tres cosas al superar el limite: devolver 429,
 * incluir la cabecera Retry-After y **registrar el evento para
 * monitorizacion**. Las dos primeras las hace el guardia de @nestjs/throttler;
 * la tercera no, y es la que alimenta la alerta de §9.2 sobre "rate limit
 * excedido consistentemente".
 *
 * El registro sigue el formato estructurado del §9.1 y no incluye cuerpo de la
 * peticion ni cabeceras de autorizacion: un log de seguridad no puede
 * convertirse en la fuga que pretende vigilar.
 */
@Injectable()
export class GuardiaDeLimitesConRegistro extends ThrottlerGuard {
  private readonly logger = new Logger('RateLimit');

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detalle: ThrottlerLimitDetail,
  ): Promise<void> {
    const http = context.switchToHttp();
    const peticion = http.getRequest<{
      method?: string;
      url?: string;
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
    }>();

    // Con varios limitadores con nombre, @nestjs/throttler emite la cabecera
    // por limitador (Retry-After-ip, Retry-After-usuario). El Plan de Seguridad
    // §4.4 pide `Retry-After` a secas, que es la que entienden los clientes
    // HTTP y la que recoge el RFC 9110, asi que se anade tambien.
    const segundos = Math.ceil(detalle.timeToBlockExpire);
    const respuesta = http.getResponse<{ header?: (n: string, v: string) => void }>();
    respuesta?.header?.('Retry-After', String(segundos));

    this.logger.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType: 'rate_limit_exceeded',
        ip: peticion?.ip ?? 'desconocida',
        path: peticion?.url ?? 'desconocido',
        method: peticion?.method ?? 'desconocido',
        userAgent: peticion?.headers?.['user-agent'] ?? 'desconocido',
        message: 'Limite de peticiones superado',
        metadata: {
          limitador: detalle.key,
          limite: detalle.limit,
          alcanzado: detalle.totalHits,
          reintentarEnSegundos: segundos,
        },
      }),
    );

    return super.throwThrottlingException(context, detalle);
  }
}
