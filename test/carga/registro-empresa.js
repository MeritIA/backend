/**
 * Auto-registro de empresa bajo carga.
 *
 * Es el unico endpoint publico que crea dos filas y hace argon2id, asi que su
 * techo lo pone la CPU del hash y no la base de datos. Ritmo bajo por omision:
 * un alta de empresa es un evento raro; lo que se quiere saber es cuanto cuesta
 * cada una y si una rafa de altas deja sin CPU al resto.
 */
import { estadisticas, registrarEmpresa, umbrales } from './comun.js';

export const options = {
  scenarios: {
    registro_empresa: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.CARGA_RPS || 3),
      timeUnit: '1s',
      duration: __ENV.CARGA_DURACION || '1m',
      preAllocatedVUs: 10,
      maxVUs: 80,
    },
  },
  thresholds: { ...umbrales, op_registro_empresa: ['p(95)<3000'] },
  summaryTrendStats: estadisticas,
};

export default function () {
  registrarEmpresa(__VU, __ITER);
}
