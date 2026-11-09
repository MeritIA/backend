/**
 * Muestrea CPU, memoria y conexiones a la base durante una corrida de carga.
 *
 *   node --env-file=.env.carga test/carga/muestrear-recursos.mjs [--pid N] [--cada 5]
 *
 * POR QUE NO LO HACE k6
 *
 * k6 mide la aplicacion desde fuera: latencias, throughput y errores. No ve lo
 * que pasa DENTRO de la maquina. La seccion 11 pide ademas CPU, memoria y
 * conexiones a la base, y sin esas tres no se puede distinguir "el backend es
 * lento" de "el backend se quedo sin conexiones" o "se esta llenando la
 * memoria". Son las que convierten un numero en un diagnostico.
 *
 * Escribe un CSV en test/carga/resultados/. Se arranca ANTES de k6 y se corta
 * con Ctrl+C al terminar; imprime el resumen al salir.
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

const args = process.argv.slice(2);
const valor = (bandera, omision) => {
  const i = args.indexOf(bandera);
  return i >= 0 && args[i + 1] ? args[i + 1] : omision;
};

const CADA_MS = Number(valor('--cada', '5')) * 1000;
const PUERTO_APP = Number(process.env.PORT ?? 3000);
const BD = process.env.DATABASE_NAME ?? 'meritia_carga';
const CARPETA = 'test/carga/resultados';
const ARCHIVO = `${CARPETA}/recursos-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;

/** Contenedores del entorno, por nombre de compose. */
const CONTENEDORES = ['meritia-postgres-1', 'meritia-redis-1', 'meritia-almacenamiento-1'];

function ejecutar(comando, parametros) {
  try {
    return execFileSync(comando, parametros, { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch {
    return '';
  }
}

/**
 * PID del backend, por el puerto en el que escucha.
 *
 * Se detecta en vez de pedirlo para que arrancar el muestreo sea un comando y
 * no un ritual de copiar numeros. Si falla, se pasa con --pid.
 */
function pidDelBackend() {
  const dado = valor('--pid', '');
  if (dado) return Number(dado);

  const salida = ejecutar('netstat', ['-ano']);
  for (const linea of salida.split(/\r?\n/)) {
    const campos = linea.trim().split(/\s+/);
    if (campos[0] === 'TCP' && campos[1]?.endsWith(`:${PUERTO_APP}`) && campos[3] === 'LISTENING') {
      return Number(campos[4]);
    }
  }
  return 0;
}

/** Memoria y CPU acumulada del proceso de Node, por PowerShell. */
function procesoDelBackend(pid) {
  if (!pid) return { memoriaMb: '', cpuSegundos: '' };
  const salida = ejecutar('powershell', [
    '-NoProfile',
    '-Command',
    // ToString con InvariantCulture a proposito: con la configuracion regional
    // en espanol, PowerShell formatea los decimales con COMA y la columna del
    // CSV queda ilegible. Paso una corrida entera escribiendo "12,34" antes de
    // notarlo.
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      'if ($p) { $inv = [System.Globalization.CultureInfo]::InvariantCulture; ' +
      '"$($p.WorkingSet64);$($p.CPU.ToString($inv))" }',
  ]);
  const [bytes, cpu] = salida.split(';');
  return {
    memoriaMb: bytes ? (Number(bytes) / 1024 / 1024).toFixed(1) : '',
    cpuSegundos: cpu ? Number(cpu).toFixed(2) : '',
  };
}

/** CPU y memoria de los contenedores, de una sola llamada a docker stats. */
function contenedores() {
  const salida = ejecutar('docker', [
    'stats',
    '--no-stream',
    '--format',
    '{{.Name}};{{.CPUPerc}};{{.MemUsage}}',
    ...CONTENEDORES,
  ]);
  const porNombre = {};
  for (const linea of salida.split(/\r?\n/)) {
    const [nombre, cpu, memoria] = linea.split(';');
    if (nombre) porNombre[nombre] = { cpu: (cpu ?? '').replace('%', ''), memoria: memoria ?? '' };
  }
  return porNombre;
}

async function conexionesABaseDeDatos() {
  const cliente = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: BD,
    // Corto: si la base esta saturada, el muestreo tiene que decirlo, no
    // quedarse esperando y perder la muestra.
    connectionTimeoutMillis: 3000,
  });
  try {
    await cliente.connect();
    const { rows } = await cliente.query(
      `select count(*)::int as total,
              count(*) filter (where state = 'active')::int as activas,
              count(*) filter (where state = 'idle')::int as ociosas,
              (select setting::int from pg_settings where name = 'max_connections') as maximo
         from pg_stat_activity
        where datname = $1`,
      [BD],
    );
    return rows[0];
  } catch {
    return { total: '', activas: '', ociosas: '', maximo: '' };
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

const COLUMNAS = [
  'momento',
  'segundos',
  'backend_memoria_mb',
  'backend_cpu_segundos',
  'bd_conexiones_total',
  'bd_conexiones_activas',
  'bd_conexiones_ociosas',
  'bd_conexiones_maximo',
  ...CONTENEDORES.flatMap((c) => [`${c}_cpu_pct`, `${c}_memoria`]),
];

mkdirSync(CARPETA, { recursive: true });
writeFileSync(ARCHIVO, `${COLUMNAS.join(',')}\n`);

const pid = pidDelBackend();
const inicio = Date.now();
let muestras = 0;
let memoriaMinima = Infinity;
let memoriaMaxima = 0;
let conexionesMaximas = 0;

console.log(
  `Muestreando cada ${CADA_MS / 1000}s -> ${ARCHIVO}\n` +
    `  backend PID ${pid || '(no detectado: pasa --pid)'}\n` +
    '  Ctrl+C para terminar y ver el resumen.\n',
);

async function muestra() {
  const proceso = procesoDelBackend(pid);
  const bd = await conexionesABaseDeDatos();
  const docker = contenedores();
  const segundos = Math.round((Date.now() - inicio) / 1000);

  const fila = [
    new Date().toISOString(),
    segundos,
    proceso.memoriaMb,
    proceso.cpuSegundos,
    bd.total,
    bd.activas,
    bd.ociosas,
    bd.maximo,
    ...CONTENEDORES.flatMap((c) => [
      docker[c]?.cpu ?? '',
      (docker[c]?.memoria ?? '').split(' / ')[0],
    ]),
  ];
  appendFileSync(ARCHIVO, `${fila.join(',')}\n`);

  muestras += 1;
  const mb = Number(proceso.memoriaMb);
  if (Number.isFinite(mb) && mb > 0) {
    memoriaMinima = Math.min(memoriaMinima, mb);
    memoriaMaxima = Math.max(memoriaMaxima, mb);
  }
  if (Number.isFinite(Number(bd.total))) {
    conexionesMaximas = Math.max(conexionesMaximas, Number(bd.total));
  }

  process.stdout.write(
    `\r  ${segundos}s  memoria ${proceso.memoriaMb || '?'} MB  ` +
      `conexiones ${bd.total || '?'}/${bd.maximo || '?'}  muestras ${muestras}   `,
  );
}

const reloj = setInterval(() => void muestra(), CADA_MS);
void muestra();

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    clearInterval(reloj);
    const crecimiento =
      memoriaMaxima > 0 && Number.isFinite(memoriaMinima)
        ? `${(memoriaMaxima - memoriaMinima).toFixed(1)} MB (de ${memoriaMinima.toFixed(1)} a ${memoriaMaxima.toFixed(1)})`
        : 'sin datos';
    console.log(
      `\n\nResumen de ${muestras} muestras en ${Math.round((Date.now() - inicio) / 1000)}s:\n` +
        `  memoria del backend: ${crecimiento}\n` +
        `  conexiones a la base, maximo observado: ${conexionesMaximas}\n` +
        `  CSV: ${ARCHIVO}\n`,
    );
    process.exit(0);
  });
}
