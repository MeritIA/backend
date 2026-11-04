/**
 * Mentor IA bajo carga.
 *
 * Mezcla lo que hace un candidato en la pantalla: abre el resumen (mucho) y
 * pregunta (menos, porque cada pregunta llama al servicio de IA). El servicio
 * de IA es el doble, con 800 ms de latencia, asi que lo que se mide es el
 * backend: armar el resumen, el limite por usuario y la espera del proveedor.
 *
 * El limite real del mentor es de 10 preguntas por minuto y por usuario; en
 * `.env.carga` se sube, por la misma razon que los demas (ver el README).
 */
import { candidatoDe, estadisticas, mentorContexto, mentorPreguntar, umbrales } from './comun.js';

export const options = {
  scenarios: {
    mentor: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.CARGA_RPS || 10),
      timeUnit: '1s',
      duration: __ENV.CARGA_DURACION || '1m',
      preAllocatedVUs: 20,
      maxVUs: 150,
    },
  },
  thresholds: umbrales,
  summaryTrendStats: estadisticas,
};

export default function () {
  const candidato = candidatoDe(__VU);
  mentorContexto(candidato);
  if (Math.random() * 100 < Number(__ENV.CARGA_PCT_PREGUNTAS || 40)) mentorPreguntar(candidato);
}
