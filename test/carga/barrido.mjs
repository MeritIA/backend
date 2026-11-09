/**
 * Barrido de ritmo creciente hasta que el sistema cae.
 *
 *   node test/carga/barrido.mjs [--ritmos 10,20,30,40,50,60,80] [--duracion 45s]
 *
 * POR QUE ADEMAS DEL ESCENARIO `stress`
 *
 * `stress.js` sube por escalones dentro de una sola corrida y su resumen los
 * promedia: demuestra que el sistema cae, pero no puede decir en que ritmo. Un
 * p95 de seis segundos repartido entre cinco escalones no es el p95 de ninguno.
 *
 * Aqui cada ritmo es una corrida aparte con su propio resumen, y eso permite
 * poner la rodilla en un numero concreto.
 *
 * COMO SE DECIDE QUE "CAYO"
 *
 * Un sistema web rara vez se apaga: se vuelve inusable antes. Asi que "caer"
 * hay que definirlo, y la definicion se escribe ANTES de ver los datos para no
 * acomodarla al resultado:
 *
 *   SANO       p95 < 500 ms, cero iteraciones descartadas, cero errores
 *   DEGRADADO  p95 < 2 s y menos del 5 % de iteraciones descartadas
 *   CAIDO      p95 >= 2 s, o >= 5 % descartadas, o > 1 % de errores inesperados
 *
 * El p95 de 500 ms viene de la expectativa de una interfaz: por encima de medio
 * segundo una lista se siente lenta. Las iteraciones descartadas son la señal
 * mas honesta de saturacion: significan que el generador no pudo mantener el
 * ritmo porque las respuestas no volvian.
 */
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opcion = (bandera, omision) => {
  const i = args.indexOf(bandera);
  return i >= 0 && args[i + 1] ? args[i + 1] : omision;
};

const RITMOS = opcion('--ritmos', '10,20,30,40,50,60,80')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => n > 0);
const DURACION = opcion('--duracion', '45s');
const URL_BASE = process.env.CARGA_URL_BASE ?? 'http://host.docker.internal:3000';
const CARPETA = resolve('test/carga');

const LIMITES = {
  sano: { p95: 500, descartadasPct: 0, erroresPct: 0 },
  degradado: { p95: 2000, descartadasPct: 5, erroresPct: 1 },
};

function clasificar(r) {
  const descartadasPct =
    r.iteraciones + r.iteraciones_descartadas > 0
      ? (r.iteraciones_descartadas / (r.iteraciones + r.iteraciones_descartadas)) * 100
      : 0;

  if (r.errores_inesperados_pct > LIMITES.degradado.erroresPct)
    return { estado: 'CAIDO', descartadasPct };
  if (r.global_p95 >= LIMITES.degradado.p95) return { estado: 'CAIDO', descartadasPct };
  if (descartadasPct >= LIMITES.degradado.descartadasPct)
    return { estado: 'CAIDO', descartadasPct };
  if (r.global_p95 < LIMITES.sano.p95 && descartadasPct === 0 && r.errores_inesperados_pct === 0) {
    return { estado: 'SANO', descartadasPct };
  }
  return { estado: 'DEGRADADO', descartadasPct };
}

function correr(rps) {
  const salida = `test/carga/resultados/escalon-${String(rps).padStart(3, '0')}.json`;
  const r = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${CARPETA}:/carga`,
      '-w',
      '/carga',
      '-e',
      `CARGA_URL_BASE=${URL_BASE}`,
      '-e',
      `CARGA_RPS=${rps}`,
      '-e',
      `CARGA_DURACION=${DURACION}`,
      'grafana/k6',
      'run',
      'escalon.js',
    ],
    { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, timeout: 600_000 },
  );

  if (!existsSync(salida)) {
    throw new Error(
      `El escalon de ${rps}/s no dejo resumen.\n${(r.stdout ?? '').slice(-1500)}${(r.stderr ?? '').slice(-800)}`,
    );
  }
  return JSON.parse(readFileSync(salida, 'utf8'));
}

mkdirSync('test/carga/resultados', { recursive: true });

console.log(
  `Barrido: ${RITMOS.join(', ')} iteraciones/s, ${DURACION} cada uno.\n` +
    'Criterios fijados antes de medir: SANO p95<500ms y 0 descartadas; ' +
    'CAIDO p95>=2s o >=5% descartadas o >1% errores.\n',
);

const filas = [];
let cayoEn = null;

for (const rps of RITMOS) {
  process.stdout.write(`  ${String(rps).padStart(3)} it/s ... `);
  const r = correr(rps);
  const { estado, descartadasPct } = clasificar(r);
  filas.push({ ...r, estado, descartadasPct });

  console.log(
    `${estado.padEnd(9)} ${Math.round(r.peticiones_por_segundo)} pet/s  ` +
      `p50 ${Math.round(r.global_p50)}ms  p95 ${Math.round(r.global_p95)}ms  ` +
      `p99 ${Math.round(r.global_p99)}ms  descartadas ${descartadasPct.toFixed(1)}%`,
  );

  if (estado === 'CAIDO' && cayoEn === null) {
    cayoEn = rps;
    // Se sigue un escalon mas para confirmar que no fue un hipo puntual.
    if (RITMOS.indexOf(rps) < RITMOS.length - 1) continue;
  }
}

const sanos = filas.filter((f) => f.estado === 'SANO').map((f) => f.rps_objetivo);
const capacidad = sanos.length > 0 ? Math.max(...sanos) : null;

console.log(
  '\n| it/s | pet/s | p50 | p95 | p99 | reporte p95 | entregar p95 | descartadas | estado |',
);
console.log('|---|---|---|---|---|---|---|---|---|');
for (const f of filas) {
  console.log(
    `| ${f.rps_objetivo} | ${Math.round(f.peticiones_por_segundo)} | ${Math.round(f.global_p50)} ms | ` +
      `${Math.round(f.global_p95)} ms | ${Math.round(f.global_p99)} ms | ` +
      `${Math.round(f.reporte_p95 ?? 0)} ms | ${Math.round(f.entregar_p95 ?? 0)} ms | ` +
      `${f.descartadasPct.toFixed(1)} % | ${f.estado} |`,
  );
}

console.log(
  `\nCapacidad sana: ${capacidad ?? 'ninguno de los ritmos probados'} iteraciones/s\n` +
    `Punto de caida: ${cayoEn ?? 'no se alcanzo en este barrido'} iteraciones/s\n`,
);
