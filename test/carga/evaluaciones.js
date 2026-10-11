/**
 * Evaluaciones concurrentes: el camino caro.
 *
 * Escenario de evaluaciones concurrentes de la seccion 11. La forma de la carga es lo unico que define
 * este archivo; el perfil de peticiones y los umbrales viven en comun.js.
 */
import { estadisticas, sesionMixta, umbrales } from './comun.js';

/**
 * La situacion que la seccion 11 nombra aparte, y la que obliga a tener el
 * doble del servicio de IA: todas las iteraciones entregan, asi que cada una
 * sube un archivo, lo guarda en el almacenamiento, abre una transaccion y
 * encola un trabajo.
 *
 * El tope esta sembrado: candidatos x intentos. Pasado ese punto empiezan los
 * 409, que se cuentan aparte porque son una respuesta correcta del dominio.
 * Si hacen falta mas entregas, se siembra con CARGA_CANDIDATOS mas alto.
 */
export const options = {
  scenarios: {
    evaluaciones: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.CARGA_RPS || 5),
      timeUnit: '1s',
      duration: __ENV.CARGA_DURACION || '90s',
      preAllocatedVUs: 30,
      maxVUs: 200,
    },
  },
  thresholds: umbrales,
  summaryTrendStats: estadisticas,
};

export default function () {
  sesionMixta(__VU, __ITER, Number(__ENV.CARGA_PCT_ENTREGAS || 100));
}
