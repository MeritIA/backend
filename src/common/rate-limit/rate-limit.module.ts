import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { GuardiaDeLimitesConRegistro } from './guardia-con-registro.js';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

/**
 * Rate limiting multicapa con Redis.
 *
 * Plan de Seguridad §4.2 define tres capas:
 *
 *   L1  por IP              100 peticiones/min   (Nginx o Cloudflare)
 *   L2  por usuario         200 peticiones/min   (Throttler de NestJS)
 *   L3  endpoints criticos  variable             (Throttler con decoradores)
 *
 * El Plan asigna la L1 al borde (Nginx/Cloudflare), no al backend. Aqui se
 * implementa igualmente en la aplicacion: en desarrollo no hay proxy delante,
 * y en produccion sirve de defensa en profundidad si el borde se salta o se
 * configura mal. El Diccionario de la EDT pide ademas "las tres capas" como
 * entregable del paquete 1.3.
 *
 * El almacen es Redis y no memoria porque los contadores tienen que ser
 * compartidos: con varias instancias del backend, un limite en memoria se
 * multiplica por el numero de procesos y deja de limitar nada.
 *
 * Respuesta a limite excedido (§4.4): 429 con cabecera Retry-After y registro
 * del evento. Las dos primeras las da el ThrottlerGuard; el registro lo anade
 * el guardia propio de mas abajo.
 */

function entero(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      // `imports` es obligatorio en los tipos de @nestjs/throttler bajo NestJS
      // 12 (issue nestjs/throttler#2672), aunque aqui no haga falta importar
      // nada: la configuracion sale de process.env, ya validado al arrancar.
      imports: [],
      useFactory: () => ({
        throttlers: [
          {
            // L1: techo por IP.
            name: 'ip',
            ttl: seconds(entero(process.env.THROTTLE_IP_TTL, 60)),
            limit: entero(process.env.THROTTLE_IP_LIMIT, 100),
          },
          {
            // L2: techo mas alto para trafico autenticado legitimo.
            name: 'usuario',
            ttl: seconds(entero(process.env.THROTTLE_USER_TTL, 60)),
            limit: entero(process.env.THROTTLE_USER_LIMIT, 200),
          },
        ],
        storage: new ThrottlerStorageRedisService({
          host: process.env.REDIS_HOST ?? 'localhost',
          port: entero(process.env.REDIS_PORT, 6379),
          password: process.env.REDIS_PASSWORD || undefined,
          // Base logica de Redis. Las pruebas de integracion usan otra para que
          // sus contadores no se mezclen con los del backend de desarrollo, y
          // para poder vaciarla sin tocar los de nadie.
          db: Number(process.env.REDIS_DB ?? 0),
        }),
        errorMessage: 'Has superado el limite de peticiones. Intentalo de nuevo mas tarde.',
      }),
    }),
  ],
  providers: [
    // Se aplica a toda la aplicacion: un endpoint queda protegido por omision,
    // y quien quiera saltarselo tiene que decirlo con @SkipThrottle.
    { provide: APP_GUARD, useClass: GuardiaDeLimitesConRegistro },
  ],
})
export class RateLimitModule {}
