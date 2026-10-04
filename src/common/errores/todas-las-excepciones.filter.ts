import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BusDeEventos } from '../events/index.js';
import {
  EVENTO_DE_SEGURIDAD,
  type EventoDeSeguridad,
  type TipoDeEventoDeSeguridad,
} from '../alertas/index.js';
import { CODIGOS, type DetalleValidacion, type RespuestaError } from './respuesta-error.js';

/**
 * Filtro global de excepciones.
 *
 * Entregable del paquete 2.4, y el control que hace cumplir su criterio de
 * aceptacion: "ningun error devuelve una traza de pila al cliente".
 *
 * La regla de fondo: **al cliente se le dice que paso, al log se le dice por
 * que**. Un error inesperado devuelve un mensaje generico y un identificador de
 * referencia; la traza completa queda en el servidor, asociada a ese mismo
 * identificador. Asi se puede diagnosticar una incidencia concreta sin que la
 * respuesta HTTP sirva de mapa a quien este probando el sistema.
 */
@Catch()
export class TodasLasExcepcionesFilter implements ExceptionFilter {
  private readonly logger = new Logger('Excepciones');

  /**
   * El bus es opcional porque este filtro se instancia a mano en el
   * arranque, no por inyeccion. Sin el, todo sigue funcionando y solo se
   * pierden las alertas, que es el comportamiento correcto para un filtro de
   * errores: nunca puede ser el motivo de que una peticion falle.
   */
  constructor(private readonly bus?: BusDeEventos) {}

  catch(excepcion: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const respuesta = ctx.getResponse<{
      status: (c: number) => { json: (b: unknown) => void };
    }>();
    const peticion = ctx.getRequest<{
      url?: string;
      method?: string;
      ip?: string;
      usuario?: { id?: string };
    }>();

    const referencia = randomUUID();
    const { estado, codigo, mensaje, errores } = this.interpretar(excepcion);

    const cuerpo: RespuestaError = {
      estado,
      codigo,
      mensaje,
      momento: new Date().toISOString(),
      ruta: peticion?.url ?? '',
      referencia,
      ...(errores ? { errores } : {}),
    };

    this.registrar(excepcion, cuerpo, peticion);
    this.publicarSiEsDeSeguridad(cuerpo, peticion);
    respuesta.status(estado).json(cuerpo);
  }

  /**
   * Publica los 401 y los 429 como eventos de seguridad (paquete 5.5).
   *
   * Aqui y no en cada guardia: este filtro ve TODAS las respuestas de error
   * con su IP, su ruta y su usuario, asi que un origen nuevo de 401 queda
   * cubierto sin tocar nada. Las reglas de cuando avisar son del servicio de
   * alertas; esto solo cuenta lo que paso.
   */
  private publicarSiEsDeSeguridad(
    cuerpo: RespuestaError,
    peticion: { url?: string; method?: string; ip?: string; usuario?: { id?: string } } | undefined,
  ): void {
    if (!this.bus) return;

    const tipo: TipoDeEventoDeSeguridad | undefined =
      cuerpo.estado === 401
        ? 'auth_failure'
        : cuerpo.estado === 429
          ? 'rate_limit_exceeded'
          : undefined;
    if (!tipo) return;

    const userId = peticion?.usuario?.id;
    this.bus.publicar<EventoDeSeguridad>({
      name: EVENTO_DE_SEGURIDAD,
      occurredAt: new Date(),
      payload: {
        tipo,
        // Por usuario cuando hay sesion, y si no por IP: contar los fallos
        // de todo el mundo en un mismo contador haria que una oficina
        // entera disparara la alerta de una sola persona.
        clave: userId ? `usuario:${userId}` : `ip:${peticion?.ip ?? 'desconocida'}`,
        momento: cuerpo.momento,
        ...(userId ? { userId } : {}),
        ...(peticion?.ip ? { ip: peticion.ip } : {}),
        ...(peticion?.url ? { ruta: peticion.url } : {}),
        ...(peticion?.method ? { metodo: peticion.method } : {}),
        metadata: { codigo: cuerpo.codigo, referencia: cuerpo.referencia },
      },
    });
  }

  /**
   * Traduce la excepcion a lo que vera el cliente.
   *
   * Solo se deja pasar el mensaje de una HttpException, que es la que el propio
   * codigo lanza a proposito. Cualquier otra cosa —un fallo de PostgreSQL, un
   * TypeError, un timeout— se convierte en un mensaje generico: esos mensajes
   * delatan el motor de base de datos, nombres de tablas o rutas del sistema de
   * ficheros.
   */
  private interpretar(excepcion: unknown): {
    estado: HttpStatus;
    codigo: string;
    mensaje: string;
    errores?: readonly DetalleValidacion[];
  } {
    if (excepcion instanceof HttpException) {
      const estado: HttpStatus = excepcion.getStatus();
      const respuesta = excepcion.getResponse();

      // ValidationPipe entrega un objeto con `message` como lista de cadenas.
      if (typeof respuesta === 'object' && respuesta !== null) {
        const r = respuesta as { message?: unknown; error?: unknown; codigo?: unknown };

        if (estado === HttpStatus.BAD_REQUEST && Array.isArray(r.message)) {
          return {
            estado,
            codigo: CODIGOS.VALIDACION,
            mensaje: 'La peticion tiene campos invalidos. Revisa el detalle.',
            errores: agruparPorCampo(r.message as string[]),
          };
        }

        const mensaje =
          typeof r.message === 'string'
            ? r.message
            : typeof r.error === 'string'
              ? r.error
              : excepcion.message;

        return {
          estado,
          codigo: typeof r.codigo === 'string' ? r.codigo : codigoPorEstado(estado),
          mensaje,
        };
      }

      return {
        estado,
        codigo: codigoPorEstado(estado),
        mensaje: typeof respuesta === 'string' ? respuesta : excepcion.message,
      };
    }

    return {
      estado: HttpStatus.INTERNAL_SERVER_ERROR,
      codigo: CODIGOS.INTERNO,
      mensaje: 'Ha ocurrido un error interno. Si persiste, reporta la referencia de este mensaje.',
    };
  }

  /** Registro estructurado, en el formato del Plan de Seguridad §9.1. */
  private registrar(
    excepcion: unknown,
    cuerpo: RespuestaError,
    peticion: { url?: string; method?: string; ip?: string } | undefined,
  ): void {
    const esperado = excepcion instanceof HttpException && cuerpo.estado < 500;

    const entrada = {
      timestamp: cuerpo.momento,
      level: esperado ? 'warn' : 'error',
      eventType: esperado ? 'request_rejected' : 'unhandled_exception',
      referencia: cuerpo.referencia,
      estado: cuerpo.estado,
      codigo: cuerpo.codigo,
      method: peticion?.method ?? '',
      path: peticion?.url ?? '',
      ip: peticion?.ip ?? '',
    };

    if (esperado) {
      // 4xx: es el sistema funcionando. No hace falta la traza.
      this.logger.warn(JSON.stringify(entrada));
      return;
    }

    // 5xx: aqui si va todo, porque es lo unico que permite diagnosticarlo.
    this.logger.error(JSON.stringify(entrada), stackDe(excepcion));
  }
}

function codigoPorEstado(estado: HttpStatus): string {
  switch (estado) {
    case HttpStatus.UNAUTHORIZED:
      return CODIGOS.NO_AUTENTICADO;
    case HttpStatus.FORBIDDEN:
      return CODIGOS.PROHIBIDO;
    case HttpStatus.NOT_FOUND:
      return CODIGOS.NO_ENCONTRADO;
    case HttpStatus.CONFLICT:
      return CODIGOS.CONFLICTO;
    case HttpStatus.TOO_MANY_REQUESTS:
      return CODIGOS.LIMITE_EXCEDIDO;
    default:
      // Number() explicito: comparar un miembro del enum con un literal
      // numerico dispara no-unsafe-enum-comparison.
      return Number(estado) >= 500 ? CODIGOS.INTERNO : 'PETICION_INVALIDA';
  }
}

/**
 * class-validator devuelve una lista plana de frases. Se agrupan por campo para
 * que el frontend pueda marcar el input concreto sin analizar texto.
 */
function agruparPorCampo(mensajes: string[]): DetalleValidacion[] {
  const porCampo = new Map<string, string[]>();

  for (const mensaje of mensajes) {
    // class-validator antepone el nombre de la propiedad al mensaje.
    const campo = mensaje.split(' ')[0] ?? 'desconocido';
    const lista = porCampo.get(campo) ?? [];
    lista.push(mensaje);
    porCampo.set(campo, lista);
  }

  return [...porCampo].map(([campo, problemas]) => ({ campo, problemas }));
}

function stackDe(excepcion: unknown): string {
  if (excepcion instanceof Error) return excepcion.stack ?? excepcion.message;
  return typeof excepcion === 'string' ? excepcion : JSON.stringify(excepcion);
}
