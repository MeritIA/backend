/**
 * Diagnostico del entorno local de MeritIA.
 *
 * Existe por un fallo concreto: con un PostgreSQL instalado en el sistema
 * escuchando en el mismo puerto que el contenedor, las conexiones acaban en la
 * instancia equivocada y el unico sintoma es "password authentication failed".
 * Ese mensaje no apunta a la causa y cuesta una tarde. Aqui se detecta y se
 * dice en una linea.
 *
 *   npm run doctor
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const VERDE = '[32m';
const AMBAR = '[33m';
const ROJO = '[31m';
const FIN = '[0m';

const raiz = path.resolve(import.meta.dirname, '..');
const ok = (m) => console.log(`  ${VERDE}OK${FIN}    ${m}`);
const aviso = (m) => console.log(`  ${AMBAR}AVISO${FIN} ${m}`);
const fallo = (m) => console.log(`  ${ROJO}FALLO${FIN} ${m}`);

let problemas = 0;

console.log('\nArchivo de entorno');
const rutaEnv = path.join(raiz, '.env');
if (!fs.existsSync(rutaEnv)) {
  fallo('.env no existe. Copialo de la plantilla:  cp .env.example .env');
  process.exit(1);
}
ok('.env encontrado');

const env = Object.fromEntries(
  fs
    .readFileSync(rutaEnv, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const obligatorias = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
];
for (const clave of obligatorias) {
  if (!env[clave]) {
    fallo(`${clave} falta o esta vacia en .env`);
    problemas++;
  }
}
if (obligatorias.every((c) => env[c])) ok('variables obligatorias presentes');

const responde = (puerto, host = '127.0.0.1') =>
  new Promise((resolve) => {
    const s = net.createConnection({ port: Number(puerto), host });
    const cerrar = (r) => {
      s.destroy();
      resolve(r);
    };
    s.setTimeout(1500);
    s.on('connect', () => cerrar(true));
    s.on('timeout', () => cerrar(false));
    s.on('error', () => cerrar(false));
  });

console.log('\nPuertos');
for (const [nombre, puerto] of [
  ['PostgreSQL', env.DATABASE_PORT],
  ['Redis', env.REDIS_PORT],
  ['MinIO', env.S3_PORT],
  ['MinIO consola', env.S3_CONSOLE_PORT],
  ['backend', env.PORT],
]) {
  if (!puerto) continue;
  if (await responde(puerto)) ok(`${nombre} responde en ${puerto}`);
  else aviso(`${nombre} no responde en ${puerto}  (levanta el entorno: docker compose up -d)`);
}

console.log('\nBase de datos');
if (await responde(env.DATABASE_PORT)) {
  try {
    const { default: pg } = await import('pg');
    const c = new pg.Client({
      host: env.DATABASE_HOST,
      port: Number(env.DATABASE_PORT),
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: env.DATABASE_NAME,
      connectionTimeoutMillis: 4000,
    });
    await c.connect();
    const { rows } = await c.query('select current_database() db, version() v');
    ok(`conectado a "${rows[0].db}" (${rows[0].v.split(',')[0]})`);
    if (!rows[0].v.includes('linux')) {
      aviso('el servidor no parece el contenedor: revisa si es un PostgreSQL del sistema');
      problemas++;
    }
    const { rows: esq } = await c.query(
      `select count(*)::int n from information_schema.schemata
       where schema_name in ('autenticacion','vacantes','ejercicios','entregas','evaluacion','reportes')`,
    );
    if (esq[0].n === 6) ok('los seis esquemas por modulo existen');
    else {
      aviso(`solo ${esq[0].n} de 6 esquemas. Falta correr:  npm run migration:run`);
      problemas++;
    }
    await c.end();
  } catch (e) {
    if (e.code === '28P01') {
      fallo('la contrasena fue rechazada.');
      console.log(
        `        Causa habitual: hay OTRO PostgreSQL escuchando en el puerto ${env.DATABASE_PORT},\n` +
          '        normalmente uno instalado en el sistema, y la conexion llega a el en vez de al\n' +
          '        contenedor. Comprueba quien tiene el puerto con:\n' +
          `          netstat -ano | findstr :${env.DATABASE_PORT}\n` +
          '        Si lo ocupa otro servidor, cambia DATABASE_PORT en .env.',
      );
    } else {
      fallo(`no se pudo conectar: ${e.code ?? ''} ${e.message}`);
    }
    problemas++;
  }
} else {
  aviso('PostgreSQL no responde; se omiten las comprobaciones de base de datos');
}

console.log(
  problemas === 0
    ? `\n${VERDE}Entorno correcto.${FIN}\n`
    : `\n${AMBAR}${problemas} punto(s) que revisar.${FIN}\n`,
);
process.exit(problemas === 0 ? 0 : 1);
