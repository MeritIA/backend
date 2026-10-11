/**
 * Carga normal esperada.
 *
 * Escenario baseline de la seccion 11. La forma de la carga es lo unico que define
 * este archivo; el perfil de peticiones y los umbrales viven en comun.js.
 */
import { estadisticas, sesionMixta, umbrales } from './comun.js';

/**
 * `constant-arrival-rate` y no `constant-vus`: lo que se quiere fijar es el
 * ritmo de peticiones, no el numero de usuarios. Con VUs fijos, si el backend
 * se pone lento el ritmo BAJA solo y la carga se adapta al problema en vez de
 * exponerlo.
 */
export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.CARGA_RPS || 10),
      timeUnit: '1s',
      duration: __ENV.CARGA_DURACION || '2m',
      preAllocatedVUs: 20,
      maxVUs: 150,
    },
  },
  thresholds: umbrales,
  summaryTrendStats: estadisticas,
};

export default function () {
  sesionMixta(__VU, __ITER, Number(__ENV.CARGA_PCT_ENTREGAS || 10));
}
