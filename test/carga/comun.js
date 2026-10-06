/**
 * Base compartida de los guiones de k6 (seccion 11 del encuadre).
 *
 * Aqui vive lo que no cambia entre escenarios: los datos sembrados, el perfil
 * de peticiones, las metricas propias y los umbrales. Cada escenario solo
 * define su forma de carga, que es lo unico que los distingue.
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/** Lo siembra `node test/carga/preparar-datos.mjs`. */
export const datos = JSON.parse(open('./datos-de-carga.json'));
export const ZIP = open('./entrega-de-carga.zip', 'b');

const BASE = __ENV.CARGA_URL_BASE || datos.urlBase;

/**
 * Metricas propias, una por operacion.
 *
 * La `http_req_duration` global mezcla un listado barato con una subida de
 * archivo, y su p95 no describe ninguna de las dos. La seccion 11 pide
 * latencias por percentil: por operacion significan algo.
 */
export const latencia = {
  listarVacantes: new Trend('op_listar_vacantes', true),
  misEntregas: new Trend('op_mis_entregas', true),
  misEvaluaciones: new Trend('op_mis_evaluaciones', true),
  reporte: new Trend('op_reporte_vacante', true),
  evaluacionesVacante: new Trend('op_evaluaciones_vacante', true),
  entregar: new Trend('op_entregar', true),
  salud: new Trend('op_salud', true),
};

export const entregasAceptadas = new Counter('entregas_aceptadas');
export const entregasSinIntentos = new Counter('entregas_sin_intentos_409');
export const erroresDeNegocio = new Rate('errores_inesperados');

/**
 * Umbrales.
 *
 * Son HIPOTESIS, no requisitos: no existe documento que fije objetivos de
 * latencia para MeritIA, asi que no se puede "cumplir" nada todavia. Se ponen
 * deliberadamente holgados para que solo salten ante un problema evidente, y
 * los numeros que salgan de la primera corrida son los que se proponen como
 * requisito en docs/rendimiento.md. Medir primero, exigir despues.
 */
export const umbrales = {
  // Lo unico que si es un error en cualquier caso: respuestas inesperadas.
  errores_inesperados: ['rate<0.01'],
  'http_req_failed{esperado:si}': ['rate<0.01'],
  op_listar_vacantes: ['p(95)<1500'],
  op_reporte_vacante: ['p(95)<3000'],
  op_entregar: ['p(95)<5000'],
};

/** Percentiles que pide la seccion 11, incluidos p50 y p99. */
export const estadisticas = ['avg', 'min', 'med', 'p(50)', 'p(95)', 'p(99)', 'max'];

const auth = (token) => ({
  headers: { Authorization: `Bearer ${token}` },
  tags: { esperado: 'si' },
});

/** Un candidato distinto por usuario virtual, repartido de forma estable. */
export function candidatoDe(vu) {
  return datos.candidatos[(vu - 1) % datos.candidatos.length];
}

function medir(trend, respuesta, esperados) {
  trend.add(respuesta.timings.duration);
  const bien = check(respuesta, {
    'estado esperado': (r) => esperados.includes(r.status),
  });
  erroresDeNegocio.add(!bien);
  return bien;
}

export function listarVacantes(candidato) {
  const r = http.get(`${BASE}/api/v1/vacantes`, auth(candidato.token));
  medir(latencia.listarVacantes, r, [200]);
}

export function misEntregas(candidato) {
  const r = http.get(`${BASE}/api/v1/entregas/mias`, auth(candidato.token));
  medir(latencia.misEntregas, r, [200]);
}

export function misEvaluaciones(candidato) {
  const r = http.get(`${BASE}/api/v1/evaluaciones/mias`, auth(candidato.token));
  medir(latencia.misEvaluaciones, r, [200]);
}

export function reporteDeVacante() {
  const r = http.get(
    `${BASE}/api/v1/reportes/vacantes/${datos.idVacante}`,
    auth(datos.reclutador.token),
  );
  medir(latencia.reporte, r, [200]);
}

export function evaluacionesDeVacante() {
  const r = http.get(
    `${BASE}/api/v1/evaluaciones/vacante/${datos.idVacante}`,
    auth(datos.reclutador.token),
  );
  medir(latencia.evaluacionesVacante, r, [200]);
}

export function salud() {
  const r = http.get(`${BASE}/api/salud`, { tags: { esperado: 'si' } });
  medir(latencia.salud, r, [200]);
}

/**
 * Sube una entrega, que es el camino caro: multipart, almacenamiento de
 * objetos, transaccion y encolado para el servicio de IA.
 *
 * El 409 cuenta aparte y NO es un error: significa que ese candidato agoto sus
 * intentos, que es una respuesta correcta del dominio. Si se contara como
 * fallo, una corrida larga pareceria degradarse cuando lo unico que pasa es
 * que se acabaron los intentos sembrados.
 */
export function entregar(candidato) {
  const r = http.post(
    `${BASE}/api/v1/entregas`,
    {
      idVacante: datos.idVacante,
      idEjercicio: datos.idEjercicio,
      archivo: http.file(ZIP, 'entrega.zip', 'application/zip'),
    },
    { headers: { Authorization: `Bearer ${candidato.token}` }, tags: { esperado: 'si' } },
  );

  latencia.entregar.add(r.timings.duration);
  const bien = check(r, { 'entrega aceptada o sin intentos': (x) => [201, 409].includes(x.status) });
  erroresDeNegocio.add(!bien);
  if (r.status === 201) entregasAceptadas.add(1);
  if (r.status === 409) entregasSinIntentos.add(1);
}

/**
 * El perfil de una sesion tipica.
 *
 * Mezcla pensada, no al azar: un candidato mira la lista de vacantes y sus
 * resultados muchas mas veces de las que entrega, y el reclutador consulta el
 * reporte a menudo. `porcentajeDeEntregas` sube el peso del camino caro en los
 * escenarios que lo quieren estresar.
 */
export function sesionMixta(vu, iteracion, porcentajeDeEntregas = 10) {
  const candidato = candidatoDe(vu);

  listarVacantes(candidato);
  misEvaluaciones(candidato);

  // El reclutador no es un usuario mas: una consulta de reporte cada cinco
  // iteraciones, que es mas realista que una por iteracion.
  if (iteracion % 5 === 0) reporteDeVacante();
  if (iteracion % 7 === 0) evaluacionesDeVacante();
  if (iteracion % 11 === 0) misEntregas(candidato);

  if (Math.random() * 100 < porcentajeDeEntregas) entregar(candidato);
}
