/**
 * De donde llega la peticion, y por tanto como se le entrega el token.
 *
 * Plan de Seguridad §7.2 pide dos formas distintas de guardar el token segun el
 * cliente, y eso obliga a entregarlo distinto:
 *
 *   web  El token viaja en una cookie HttpOnly y NO aparece en el cuerpo de la
 *        respuesta. Es lo que hace cumplir el criterio del paquete 3.5: "el
 *        token no es legible desde JavaScript en la version web". Si el token
 *        llegara tambien en el JSON, cualquier XSS podria leerlo del cuerpo del
 *        login, y la cookie no habria servido de nada.
 *
 *   apk  El token viaja en el cuerpo, porque la aplicacion movil lo guarda ella
 *        misma en el KeyStore de Android o el Keychain de iOS. Una cookie no
 *        sirve ahi: el almacen de cookies del WebView no es almacenamiento
 *        seguro del sistema, y ademas los esquemas nativos (capacitor://) no
 *        comparten cookies con el dominio de la API.
 *
 * El cliente lo declara al iniciar sesion. No se adivina por el User-Agent:
 * eso se falsifica en una linea, y aqui equivocarse significa devolver el token
 * en el cuerpo a un navegador.
 */
export enum TipoCliente {
  Web = 'web',
  Apk = 'apk',
}

/** Nombre de la cookie de acceso. */
export const COOKIE_ACCESO = 'meritia_acceso';

/** Nombre de la cookie de renovacion. */
export const COOKIE_RENOVACION = 'meritia_renovacion';

/**
 * Opciones de la cookie, segun el Plan §7.2.
 *
 * - httpOnly  JavaScript no la puede leer. Es el control central.
 * - secure    Solo viaja por HTTPS. Se apaga fuera de produccion porque en
 *             local no hay certificado y el navegador descartaria la cookie.
 * - sameSite  'strict': la cookie no se envia en peticiones que nazcan de otro
 *             sitio, asi que un formulario en una web ajena no puede actuar en
 *             nombre del usuario. Es la defensa contra CSRF que el propio Plan
 *             nombra.
 * - path      Acotado a la API.
 */
export function opcionesDeCookie(
  duracionMs: number,
  entorno = process.env.NODE_ENV,
): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: entorno === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: duracionMs,
  };
}
