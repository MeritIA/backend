/**
 * Un escalon de ritmo constante, para el barrido que busca el punto de caida.
 *
 * El escenario `stress` sube por escalones en UNA corrida, y su resumen los
 * promedia: sirve para ver que el sistema cae, no para decir donde. Aqui cada
 * ritmo se corre por separado y escribe su propio resumen, que es lo que
 * permite poner la rodilla en un numero.
 */
import { estadisticas, sesionMixta } from './comun.js';

const RPS = Number(__ENV.CARGA_RPS || 10);

export const options = {
  scenarios: {
    escalon: {
      executor: 'constant-arrival-rate',
      rate: RPS,
      timeUnit: '1s',
      duration: __ENV.CARGA_DURACION || '45s',
      // Holgado: si k6 se queda sin usuarios virtuales, descarta iteraciones y
      // eso se confundiria con que el backend no da abasto. Con margen, las
      // iteraciones descartadas significan lo que tienen que significar.
      preAllocatedVUs: Math.max(50, RPS * 4),
      maxVUs: Math.max(200, RPS * 20),
    },
  },
  summaryTrendStats: estadisticas,
  // Sin umbrales: el barrido mide, no juzga.
};

export default function () {
  sesionMixta(__VU, __ITER, Number(__ENV.CARGA_PCT_ENTREGAS || 10));
}

export function handleSummary(datos) {
  const m = datos.metrics;
  const valor = (nombre, campo) => m[nombre]?.values?.[campo] ?? null;

  const resumen = {
    rps_objetivo: RPS,
    peticiones: valor('http_reqs', 'count'),
    peticiones_por_segundo: valor('http_reqs', 'rate'),
    iteraciones: valor('iterations', 'count'),
    iteraciones_descartadas: valor('dropped_iterations', 'count') ?? 0,
    errores_inesperados_pct: (valor('errores_inesperados', 'rate') ?? 0) * 100,
    global_p50: valor('http_req_duration', 'p(50)'),
    global_p95: valor('http_req_duration', 'p(95)'),
    global_p99: valor('http_req_duration', 'p(99)'),
    listar_p95: valor('op_listar_vacantes', 'p(95)'),
    reporte_p95: valor('op_reporte_vacante', 'p(95)'),
    entregar_p95: valor('op_entregar', 'p(95)'),
    vus_maximo: valor('vus_max', 'value'),
  };

  return {
    [`resultados/escalon-${String(RPS).padStart(3, '0')}.json`]: JSON.stringify(resumen, null, 2),
    stdout:
      `  ${RPS} pet/s objetivo -> ${Math.round(resumen.peticiones_por_segundo)} pet/s reales, ` +
      `p95 ${Math.round(resumen.global_p95)} ms, descartadas ${resumen.iteraciones_descartadas}
`,
  };
}
