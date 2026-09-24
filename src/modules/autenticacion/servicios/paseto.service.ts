import { Injectable, Logger, Optional } from '@nestjs/common';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import pkg from 'paseto';
import { Rol } from '../dominio/rol.js';

const { V4, errors } = pkg;

/**
 * Emision y verificacion de tokens PASETO v4.
 *
 * Plan de Seguridad §2: PASETO en lugar de JWT, version v4.public con firmas
 * Ed25519, y el campo `exp` como cadena ISO8601 y no como timestamp Unix.
 *
 * Por que PASETO y no JWT, segun el propio Plan: JWT permite por defecto
 * algoritmos inseguros y opciones mal configurables —empezando por `alg: none`—
 * mientras que cada version de PASETO fija sus primitivas. Para una plataforma
 * propia, sin identidad federada, la compatibilidad que aporta JWT no compensa
 * ese riesgo.
 */

export type TipoDeToken = 'acceso' | 'renovacion';

export interface ContenidoToken {
  /** Identificador del usuario. */
  readonly sub: string;
  readonly rol: Rol;
  /** Empresa del usuario, o null si no tiene (candidato, o admin de plataforma). */
  readonly emp: string | null;
  readonly tipo: TipoDeToken;
  /** Expiracion en ISO8601. */
  readonly exp: string;
  /** Emision en ISO8601. */
  readonly iat: string;
}

/** Motivo del rechazo. Se registra; al cliente solo le llega un 401. */
export type MotivoRechazo =
  | 'formato_invalido'
  | 'firma_invalida'
  | 'expiracion_ausente'
  | 'expiracion_mal_formada'
  | 'token_vencido'
  | 'tipo_incorrecto'
  | 'contenido_incompleto';

export class TokenRechazadoError extends Error {
  constructor(readonly motivo: MotivoRechazo) {
    super(`Token rechazado: ${motivo}`);
  }
}

function desdeBase64(valor: string): string {
  return Buffer.from(valor, 'base64').toString('utf8');
}

@Injectable()
export class PasetoService {
  private readonly logger = new Logger('Autenticacion');
  private readonly clavePrivada: KeyObject;
  private readonly clavePublica: KeyObject;
  private readonly horasDeAcceso: number;
  private readonly diasDeRenovacion: number;

  /**
   * `env` va como @Optional() para que Nest no intente inyectarlo: es un
   * parametro de conveniencia para las pruebas, no una dependencia del
   * contenedor. En ejecucion siempre cae a process.env.
   */
  constructor(@Optional() entorno?: NodeJS.ProcessEnv) {
    const env = entorno ?? process.env;
    const priv = env.PASETO_PRIVATE_KEY;
    const pub = env.PASETO_PUBLIC_KEY;
    if (!priv || !pub) {
      throw new Error(
        'PASETO_PRIVATE_KEY y PASETO_PUBLIC_KEY son obligatorias. Generalas con: npm run claves:generar',
      );
    }
    this.clavePrivada = createPrivateKey(desdeBase64(priv));
    this.clavePublica = createPublicKey(desdeBase64(pub));
    this.horasDeAcceso = Number(env.TOKEN_EXPIRATION_HOURS ?? 24);
    this.diasDeRenovacion = Number(env.REFRESH_TOKEN_EXPIRATION_DAYS ?? 7);
  }

  async emitirAcceso(idUsuario: string, rol: Rol, idEmpresa: string | null): Promise<string> {
    return this.emitir(idUsuario, rol, idEmpresa, 'acceso', this.horasDeAcceso * 3600_000);
  }

  async emitirRenovacion(idUsuario: string, rol: Rol, idEmpresa: string | null): Promise<string> {
    return this.emitir(idUsuario, rol, idEmpresa, 'renovacion', this.diasDeRenovacion * 86_400_000);
  }

  private async emitir(
    sub: string,
    rol: Rol,
    idEmpresa: string | null,
    tipo: TipoDeToken,
    duracionMs: number,
  ): Promise<string> {
    const ahora = new Date();
    const contenido: ContenidoToken = {
      sub,
      rol,
      emp: idEmpresa,
      tipo,
      // ISO8601, como exige el Plan §2.2. El riesgo que el Diccionario señala en
      // este paquete es precisamente este: un `exp` mal implementado deja
      // tokens validos indefinidamente.
      exp: new Date(ahora.getTime() + duracionMs).toISOString(),
      iat: ahora.toISOString(),
    };
    // V4.sign espera un Record; una interfaz declarada no encaja por no
    // tener firma de indice. El objeto es el mismo.
    return V4.sign({ ...contenido }, this.clavePrivada);
  }

  /**
   * Verifica firma, forma y vigencia.
   *
   * La libreria ya comprueba la firma y la expiracion, pero la validacion del
   * `exp` se repite aqui a proposito: el criterio del paquete pide que la
   * verificacion "valide el formato de la expiracion y la compare con la hora
   * del servidor", y un control que se delega por completo a un tercero no se
   * puede probar de forma independiente.
   */
  async verificar(token: string, tipoEsperado: TipoDeToken): Promise<ContenidoToken> {
    let bruto: Record<string, unknown>;

    try {
      // ignoreExp: la expiracion se comprueba abajo, con nuestro propio criterio
      // y nuestros propios mensajes.
      bruto = await V4.verify(token, this.clavePublica, { ignoreExp: true });
    } catch (e) {
      // La libreria valida el formato de las fechas incluso con ignoreExp, y en
      // ese caso lanza PasetoClaimInvalid. Se distingue del fallo de firma para
      // que el log de seguridad diga la verdad: etiquetar un `exp` mal formado
      // como "firma invalida" mandaria a investigar una falsificacion
      // inexistente.
      //
      // Al cliente le llega el mismo 401 en ambos casos: la distincion es para
      // quien lee los logs, no para quien sondea.
      if (e instanceof errors.PasetoClaimInvalid) {
        throw this.rechazar('expiracion_mal_formada');
      }
      throw this.rechazar('firma_invalida');
    }

    const { sub, rol, emp, tipo, exp, iat } = bruto as Partial<ContenidoToken>;

    if (typeof sub !== 'string' || !sub || typeof rol !== 'string' || typeof iat !== 'string') {
      throw this.rechazar('contenido_incompleto');
    }
    if (!(Object.values(Rol) as string[]).includes(rol)) {
      throw this.rechazar('contenido_incompleto');
    }
    // La empresa puede faltar (candidato o admin de plataforma), pero si viene
    // tiene que ser una cadena: un objeto ahi seria un token manipulado.
    if (emp !== undefined && emp !== null && typeof emp !== 'string') {
      throw this.rechazar('contenido_incompleto');
    }
    if (exp === undefined || exp === null) {
      // Sin expiracion el token seria eterno. Se rechaza en vez de asumir una.
      throw this.rechazar('expiracion_ausente');
    }
    if (typeof exp !== 'string') {
      // Un timestamp Unix numerico entra por aqui: el Plan exige ISO8601.
      throw this.rechazar('expiracion_mal_formada');
    }

    const vence = new Date(exp);
    if (Number.isNaN(vence.getTime()) || vence.toISOString() !== exp) {
      throw this.rechazar('expiracion_mal_formada');
    }
    if (vence.getTime() <= Date.now()) {
      throw this.rechazar('token_vencido');
    }
    if (tipo !== tipoEsperado) {
      // Un token de renovacion no vale para consumir la API, ni al reves.
      throw this.rechazar('tipo_incorrecto');
    }

    return { sub, rol, emp: emp ?? null, tipo, exp, iat };
  }

  /** Registro estructurado del fallo (Plan §9.1), sin exponer nada al cliente. */
  private rechazar(motivo: MotivoRechazo): TokenRechazadoError {
    this.logger.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType: 'token_verification_failed',
        message: 'Verificacion de token fallida',
        metadata: { motivo },
      }),
    );
    return new TokenRechazadoError(motivo);
  }
}
