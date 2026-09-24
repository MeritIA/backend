import {
  COOKIE_ACCESO,
  COOKIE_RENOVACION,
  TipoCliente,
  opcionesDeCookie,
} from './dominio/tipo-cliente.js';
import type { SesionRespuesta } from './dto/index.js';

/** Lo minimo que necesitamos de la respuesta HTTP, sin atarnos a Express. */
export interface RespuestaConCookies {
  cookie: (nombre: string, valor: string, opciones: Record<string, unknown>) => unknown;
  clearCookie: (nombre: string, opciones?: Record<string, unknown>) => unknown;
}

/** Sesion tal como sale del servicio, con los dos tokens siempre presentes. */
export interface SesionCompleta {
  readonly tokenDeAcceso: string;
  readonly tokenDeRenovacion: string;
  readonly expiraEn: string;
  readonly rol: SesionRespuesta['rol'];
  readonly idUsuario: string;
}

const HORA_MS = 3600_000;
const DIA_MS = 86_400_000;

/**
 * Decide como se le entrega la sesion al cliente.
 *
 * Es el punto donde se cumple el primer criterio del paquete 3.5, y esta
 * aparte del controlador a proposito: la regla de "en web el token no va en el
 * cuerpo" tiene que valer igual en registro, en login y en renovacion, y
 * repetirla tres veces es como se acaba olvidando en una.
 *
 * En web: cookies HttpOnly, y el cuerpo sale SIN tokens.
 * En APK: el cuerpo lleva los tokens y no se pone ninguna cookie, porque el
 * almacen de cookies del WebView no es almacenamiento seguro del sistema.
 */
export function entregarSesion(
  sesion: SesionCompleta,
  cliente: TipoCliente,
  respuesta: RespuestaConCookies,
  env: NodeJS.ProcessEnv = process.env,
): SesionRespuesta {
  const base = { expiraEn: sesion.expiraEn, rol: sesion.rol, idUsuario: sesion.idUsuario };

  if (cliente === TipoCliente.Apk) {
    return {
      ...base,
      tokenDeAcceso: sesion.tokenDeAcceso,
      tokenDeRenovacion: sesion.tokenDeRenovacion,
    };
  }

  const horas = Number(env.TOKEN_EXPIRATION_HOURS ?? 24);
  const dias = Number(env.REFRESH_TOKEN_EXPIRATION_DAYS ?? 7);

  respuesta.cookie(
    COOKIE_ACCESO,
    sesion.tokenDeAcceso,
    opcionesDeCookie(horas * HORA_MS, env.NODE_ENV),
  );
  respuesta.cookie(
    COOKIE_RENOVACION,
    sesion.tokenDeRenovacion,
    opcionesDeCookie(dias * DIA_MS, env.NODE_ENV),
  );

  // Sin tokens en el cuerpo: es todo el punto.
  return base;
}

/** Borra las cookies de sesion. Se usa al cerrar sesion. */
export function limpiarCookies(respuesta: RespuestaConCookies, env = process.env): void {
  const opciones = { ...opcionesDeCookie(0, env.NODE_ENV), maxAge: undefined };
  respuesta.clearCookie(COOKIE_ACCESO, opciones);
  respuesta.clearCookie(COOKIE_RENOVACION, opciones);
}

/**
 * Saca el token de acceso de la peticion.
 *
 * Se mira primero la cabecera y luego la cookie. El orden importa poco, pero
 * aceptar ambas es lo que permite que la web y la APK usen el mismo backend sin
 * dos rutas distintas.
 */
export function tokenDeLaPeticion(peticion: {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}): string | null {
  const cabecera = peticion.headers?.authorization;
  if (typeof cabecera === 'string') {
    const [esquema, valor, ...resto] = cabecera.trim().split(/\s+/);
    if (resto.length === 0 && esquema?.toLowerCase() === 'bearer' && valor) return valor;
  }
  return peticion.cookies?.[COOKIE_ACCESO] ?? null;
}
