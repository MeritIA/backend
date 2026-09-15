/**
 * Crea el .env de la integracion continua a partir de .env.example.
 *
 *   node scripts/preparar-env-ci.mjs
 *
 * Las claves y contrasenas se generan en el momento y mueren con la ejecucion:
 * no existen en ningun otro sitio, no sirven en ningun ambiente real y no hay
 * nada que filtrar ni que rotar. Es la razon de que la CI no necesite secretos
 * para correr las pruebas, y de que ningun secreto de un ambiente se reutilice
 * en otro (criterio de aceptacion del paquete 1.2).
 *
 * No sobrescribe un .env existente: en una maquina de desarrollo destruiria la
 * configuracion de quien lo ejecute por error.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { generarClaves } from './lib/claves.mjs';

if (existsSync('.env')) {
  console.error('Ya existe .env y no se sobrescribe. Este script es para la CI.');
  process.exit(1);
}

const secretos = {
  ...(await generarClaves()),
  DATABASE_PASSWORD: randomBytes(24).toString('hex'),
  S3_SECRET_KEY: randomBytes(24).toString('hex'),
};

// En GitHub Actions, que ningun paso posterior pueda imprimirlos por accidente.
if (process.env.GITHUB_ACTIONS === 'true') {
  for (const valor of Object.values(secretos)) console.log(`::add-mask::${valor}`);
}

const pendientes = new Set(Object.keys(secretos));
const lineas = readFileSync('.env.example', 'utf8')
  .split(/\r?\n/)
  .map((linea) => {
    const clave = /^([A-Z0-9_]+)=/.exec(linea)?.[1];
    if (!clave || !(clave in secretos)) return linea;
    pendientes.delete(clave);
    return `${clave}=${secretos[clave]}`;
  });

if (pendientes.size > 0) {
  console.error(`.env.example no declara: ${[...pendientes].join(', ')}`);
  process.exit(1);
}

writeFileSync('.env', lineas.join('\n'), { mode: 0o600 });
console.log(`.env de CI creado con ${Object.keys(secretos).length} secretos efimeros.`);
