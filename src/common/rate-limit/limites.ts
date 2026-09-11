import { Throttle } from '@nestjs/throttler';
import { seconds, minutes } from '@nestjs/throttler';

/**
 * L3 del Plan de Seguridad §4.2: limites propios de endpoints criticos.
 *
 * Se declaran aqui, en un solo sitio, y no sueltos por cada controlador. Asi
 * los numeros se revisan juntos y nadie tiene que recordar cual era el del
 * login. Los valores salen del §4.3 del Plan y del criterio de aceptacion del
 * paquete 2.1 de la EDT.
 *
 *   @LimiteLogin()
 *   @Post('login')
 *   async login(...) {}
 */

function entero(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

/**
 * Diez intentos de inicio de sesion por minuto.
 *
 * Es el freno a la fuerza bruta de contrasenas. El criterio de aceptacion del
 * paquete 2.1 lo exige textualmente.
 */
export const LimiteLogin = () =>
  Throttle({
    ip: {
      limit: entero(process.env.THROTTLE_LOGIN_LIMIT, 10),
      ttl: seconds(entero(process.env.THROTTLE_LOGIN_TTL, 60)),
    },
  });

/**
 * Cinco entregas cada cinco minutos.
 *
 * Cada entrega dispara una evaluacion con IA, que cuesta dinero y tiempo de
 * computo. Este limite protege el presupuesto tanto como el servicio.
 */
export const LimiteEntrega = () =>
  Throttle({
    ip: {
      limit: entero(process.env.THROTTLE_SUBMISSION_LIMIT, 5),
      ttl: minutes(entero(process.env.THROTTLE_SUBMISSION_TTL_MINUTES, 5)),
    },
  });
