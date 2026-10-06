/**
 * Sube el ritmo hasta encontrar el limite.
 *
 * Escenario stress de la seccion 11. La forma de la carga es lo unico que define
 * este archivo; el perfil de peticiones y los umbrales viven en comun.js.
 */
import { estadisticas, sesionMixta, umbrales } from './comun.js';

/**
 * Sube por escalones y no en una rampa continua: un escalon sostenido permite
 * ver si el sistema se estabiliza en ese ritmo o si empieza a acumular retraso.
 * Una rampa continua mezcla las dos cosas.
 *
 * SIN UMBRALES. Aqui se busca el punto de rotura a proposito, asi que un
 * umbral que falle no informaria de nada: el dato es DONDE se rompe.
 */
export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 600,
      stages: [
        { target: 25, duration: '45s' },
        { target: 50, duration: '45s' },
        { target: 100, duration: '45s' },
        { target: 200, duration: '45s' },
        { target: 400, duration: '45s' },
      ],
    },
  },
  summaryTrendStats: estadisticas,
};

export default function () {
  sesionMixta(__VU, __ITER, Number(__ENV.CARGA_PCT_ENTREGAS || 10));
}
