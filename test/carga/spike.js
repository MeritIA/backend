/**
 * Subida subita de usuarios.
 *
 * Escenario spike de la seccion 11. La forma de la carga es lo unico que define
 * este archivo; el perfil de peticiones y los umbrales viven en comun.js.
 */
import { estadisticas, sesionMixta, umbrales } from './comun.js';

/**
 * De 5 a 250 peticiones por segundo en diez segundos, se mantiene medio
 * minuto y vuelve a bajar. Lo que se mira no es solo si aguanta el pico: es si
 * RECUPERA despues. Un sistema que queda degradado cuando la carga ya bajo
 * tiene algo encolado o una conexion que no devolvio.
 */
export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: 5, duration: '20s' },
        { target: 250, duration: '10s' },
        { target: 250, duration: '30s' },
        { target: 5, duration: '10s' },
        { target: 5, duration: '40s' },
      ],
    },
  },
  summaryTrendStats: estadisticas,
};

export default function () {
  sesionMixta(__VU, __ITER, Number(__ENV.CARGA_PCT_ENTREGAS || 10));
}
