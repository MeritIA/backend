/**
 * Carga sostenida, para cazar fugas y degradacion.
 *
 * Escenario soak de la seccion 11. La forma de la carga es lo unico que define
 * este archivo; el perfil de peticiones y los umbrales viven en comun.js.
 */
import { estadisticas, sesionMixta, umbrales } from './comun.js';

/**
 * Ritmo moderado durante mucho tiempo. Lo que busca no es el limite sino la
 * DERIVA: memoria que sube y no baja, latencia que empeora con las horas,
 * conexiones a la base que no se devuelven, workers que se quedan colgados.
 *
 * `CARGA_DURACION` por omision son 10 minutos, que alcanza para ver una
 * tendencia pero NO es un soak de verdad. Uno serio son horas, y la cifra que
 * se reporte tiene que decir cuanto se corrio de verdad.
 */
export const options = {
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.CARGA_RPS || 15),
      timeUnit: '1s',
      duration: __ENV.CARGA_DURACION || '10m',
      preAllocatedVUs: 30,
      maxVUs: 200,
    },
  },
  thresholds: umbrales,
  summaryTrendStats: estadisticas,
};

export default function () {
  sesionMixta(__VU, __ITER, Number(__ENV.CARGA_PCT_ENTREGAS || 10));
}
