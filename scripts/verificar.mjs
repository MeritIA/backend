/**
 * Verificacion rapida del proyecto, pensada para correr como hook Stop.
 *
 *   node scripts/verificar.mjs           salida legible, para ejecutarlo a mano
 *   node scripts/verificar.mjs --hook    salida JSON, para el hook de Claude Code
 *
 * Corre lint, compilacion y pruebas unitarias. NO corre las de integracion ni
 * la cobertura: esas necesitan Docker levantado y tardan un minuto, demasiado
 * para dispararse en cada respuesta. Para el ciclo completo: npm run test:total
 *
 * SALTA EL TRABAJO SI NADA CAMBIO. Guarda una huella del contenido de src/,
 * test/ y la configuracion; si coincide con la de la ultima ejecucion, termina
 * en milisegundos. Sin esto, una conversacion de veinte respuestas pagaria
 * veinte veces veinte segundos por verificar lo mismo.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(RAIZ, 'node_modules', '.cache', 'meritia-verificacion.json');
const modoHook = process.argv.includes('--hook');

/** Huella del codigo: ruta, tamano y fecha de cada archivo que importa. */
function huella() {
  const hash = createHash('sha256');
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
      const completa = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completa);
      else if (/\.(ts|mjs|json)$/.test(entrada.name)) {
        const s = statSync(completa);
        hash.update(`${completa}:${s.size}:${s.mtimeMs}`);
      }
    }
  };

  for (const d of ['src', 'test']) {
    if (existsSync(path.join(RAIZ, d))) recorrer(path.join(RAIZ, d));
  }
  for (const f of ['package.json', 'tsconfig.json', 'eslint.config.mjs']) {
    const completa = path.join(RAIZ, f);
    if (existsSync(completa)) hash.update(readFileSync(completa));
  }
  return hash.digest('hex');
}

function leerCache() {
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {
    return null;
  }
}

function guardarCache(datos) {
  try {
    mkdirSync(path.dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(datos), 'utf8');
  } catch {
    // Que no se pueda cachear no es motivo para fallar la verificacion.
  }
}

function correr(comando) {
  try {
    execSync(comando, { cwd: RAIZ, stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, salida: '' };
  } catch (e) {
    const bruto = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return { ok: false, salida: bruto.replace(/\[[0-9;]*m/g, '').trim() };
  }
}

/** Primeras lineas utiles del error, sin el ruido de npm. */
function resumirFallo(salida, maximo = 6) {
  const lineas = salida
    .split('\n')
    .filter(
      (l) =>
        l.trim() &&
        !/^npm (error|warn|notice)/.test(l.trim()) &&
        !/^>/.test(l.trim()) &&
        !/^$/.test(l.trim()),
    );
  const utiles = lineas.filter((l) => /error|✖|×|FAIL|expected/i.test(l));
  return (utiles.length > 0 ? utiles : lineas).slice(0, maximo).join('\n');
}

const actual = huella();
const cache = leerCache();

if (cache?.huella === actual && cache?.ok) {
  const mensaje = 'Verificacion: sin cambios en el codigo desde la ultima comprobacion.';
  console.log(modoHook ? JSON.stringify({ suppressOutput: true }) : mensaje);
  process.exit(0);
}

const pasos = [
  ['lint', 'npm run lint'],
  ['compilacion', 'npm run build'],
  ['pruebas unitarias', 'npx vitest run --silent'],
];

const fallos = [];
for (const [nombre, comando] of pasos) {
  const r = correr(comando);
  if (!r.ok) {
    fallos.push({ nombre, detalle: resumirFallo(r.salida) });
    // Se para en el primero: sin compilar, las pruebas fallarian por lo mismo y
    // el segundo error solo taparia al primero.
    break;
  }
}

guardarCache({ huella: actual, ok: fallos.length === 0, cuando: new Date().toISOString() });

if (fallos.length === 0) {
  const mensaje = 'Verificacion OK: lint, compilacion y pruebas unitarias en verde.';
  console.log(modoHook ? JSON.stringify({ systemMessage: mensaje }) : mensaje);
  process.exit(0);
}

const [fallo] = fallos;
const mensaje = `Verificacion FALLIDA en ${fallo.nombre}:\n${fallo.detalle}\n\nCiclo completo: npm run test:total`;

if (modoHook) {
  // Solo informa: no se bloquea el turno. Un hook que corta la conversacion por
  // un error de lint estorba mas de lo que ayuda; la decision de arreglarlo
  // ahora o despues es de quien esta trabajando.
  console.log(JSON.stringify({ systemMessage: mensaje }));
  process.exit(0);
}

console.error(mensaje);
process.exit(1);
