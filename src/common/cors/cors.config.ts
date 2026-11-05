import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { Logger } from '@nestjs/common';

/**
 * Politica de CORS diferenciada por tipo de cliente.
 *
 * Plan de Seguridad §3.1: la web de Angular llega desde un dominio concreto y
 * la APK generada con Capacitor desde un esquema nativo (capacitor://localhost
 * en Android, ionic://localhost en iOS).
 *
 * DESVIACION RESPECTO DEL CODIGO DE EJEMPLO DEL PLAN, deliberada y anotada
 * segun la regla de no conformidad del encuadre:
 *
 * El ejemplo del Plan §3.2 decide asi:
 *
 *     if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production')
 *
 * Esa segunda condicion permite CUALQUIER origen fuera de produccion, y con
 * `credentials: true`. En la maquina de cualquiera del equipo, o en un entorno
 * de pruebas desplegado, una web maliciosa podria lanzar peticiones
 * autenticadas contra el backend y leer la respuesta. Ademas es un fallo que no
 * se nota: todo funciona, hasta que alguien despliega pruebas con NODE_ENV mal
 * puesto.
 *
 * Aqui la lista blanca se aplica en todos los entornos. Lo que cambia entre
 * ellos es su contenido, no si se respeta. Se sigue cumpliendo el criterio de
 * aceptacion del paquete 1.3 ("un origen no autorizado recibe error de CORS en
 * produccion") y ademas fuera de produccion.
 */

const ORIGENES_DE_DESARROLLO = [
  'http://localhost:4200', // servidor de desarrollo de Angular
  'http://localhost:8100', // servidor de Ionic/Capacitor
  'https://localhost', // WebView de Capacitor >= 6 en Android (androidScheme: 'https')
  'capacitor://localhost', // APK Android con esquema propio / iOS
  'ionic://localhost', // iOS en desarrollo
] as const;

const logger = new Logger('CORS');

export class OrigenNoPermitidoError extends Error {
  constructor(origen: string) {
    super(`Origen no permitido por CORS: ${origen}`);
  }
}

export function origenesPermitidos(
  entorno = process.env.NODE_ENV,
  configurados = process.env.ALLOWED_ORIGINS,
): string[] {
  const deEntorno = (configurados ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (entorno === 'production') {
    if (deEntorno.length === 0) {
      // Sin lista en produccion se niega todo, en vez de abrir por comodidad.
      logger.error('ALLOWED_ORIGINS esta vacia en produccion: se rechazaran todos los origenes.');
    }
    return deEntorno;
  }

  // Fuera de produccion, lo configurado se suma a los origenes de desarrollo.
  return [...new Set([...ORIGENES_DE_DESARROLLO, ...deEntorno])];
}

export function construirOpcionesCors(
  entorno = process.env.NODE_ENV,
  configurados = process.env.ALLOWED_ORIGINS,
): CorsOptions {
  const permitidos = origenesPermitidos(entorno, configurados);

  return {
    origin(origen, callback) {
      // Peticiones sin cabecera Origin: cliente nativo de la APK, Postman,
      // llamadas servidor a servidor. El navegador siempre envia Origin en una
      // peticion cruzada, asi que esto no abre una via desde una web ajena.
      if (!origen) return callback(null, true);

      if (permitidos.includes(origen)) return callback(null, true);

      logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'security',
          eventType: 'cors_origin_rejected',
          origin: origen,
          message: 'Origen no permitido por CORS',
        }),
      );

      // Se responde sin la cabecera Access-Control-Allow-Origin en lugar de
      // lanzar un error. Pasar un Error al callback lo convierte en un 500, que
      // es una excepcion sin manejar y delata que algo reventó por dentro.
      //
      // Omitir la cabecera es ademas el mecanismo real: CORS lo hace cumplir el
      // navegador, que se niega a entregar la respuesta a la pagina que la
      // pidio. Un cliente que no sea un navegador ignora CORS de todas formas
      // y falsifica la cabecera Origin sin esfuerzo, asi que CORS nunca es la
      // defensa contra el: de eso se ocupan la autenticacion y los limites de
      // peticiones.
      return callback(null, false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With',
    exposedHeaders: 'Authorization, Retry-After',
    credentials: true,
    maxAge: 86_400,
  };
}
