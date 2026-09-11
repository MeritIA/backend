import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Preparacion del entorno para las pruebas de integracion.
 *
 * Estas pruebas hablan con PostgreSQL y con Redis de verdad. No hay dobles: lo
 * que se quiere comprobar es justamente lo que un doble ocultaria —las
 * restricciones de la base de datos, las transacciones con bloqueo, los
 * transformadores de cifrado y los contadores del rate limiting.
 *
 * Se usa una base de datos APARTE, `meritia_pruebas`, y no la de desarrollo:
 * las pruebas borran tablas entre casos y hacerlo sobre la de trabajo
 * destruiria los datos de quien este probando la aplicacion a mano.
 */

const RAIZ = path.resolve(import.meta.dirname, '..', '..');
export const BD_DE_PRUEBAS = 'meritia_pruebas';

/** Lee .env sin depender de dotenv: son cuatro lineas y evita una dependencia. */
function leerEnv(): Record<string, string> {
  const ruta = path.join(RAIZ, '.env');
  if (!existsSync(ruta)) {
    throw new Error(
      'Falta .env. Copialo de la plantilla:  cp .env.example .env\n' +
        'Las pruebas de integracion necesitan el entorno real.',
    );
  }
  return Object.fromEntries(
    readFileSync(ruta, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

/**
 * Deja process.env listo y crea la base de pruebas si no existe.
 *
 * Los limites de peticiones se suben muy alto: lo que se prueba aqui es la
 * logica de negocio, y un 429 a mitad de una bateria de casos seria un fallo
 * del montaje y no del codigo. El rate limiting tiene sus propias pruebas.
 */
export async function prepararEntorno(): Promise<void> {
  const env = leerEnv();
  for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_NAME = BD_DE_PRUEBAS;
  process.env.THROTTLE_IP_LIMIT = '100000';
  process.env.THROTTLE_USER_LIMIT = '100000';
  process.env.THROTTLE_LOGIN_LIMIT = '100000';

  const admin = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: 'postgres',
  });

  try {
    await admin.connect();
  } catch (e) {
    throw new Error(
      `No se pudo conectar a PostgreSQL en ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}.\n` +
        'Levanta el entorno antes de correr estas pruebas:  docker compose up -d\n' +
        `Detalle: ${(e as Error).message}`,
    );
  }

  const existe = await admin.query('select 1 from pg_database where datname = $1', [BD_DE_PRUEBAS]);
  if (existe.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${BD_DE_PRUEBAS}"`);
  }
  await admin.end();
}

/** Aplica las migraciones sobre la base de pruebas. */
export async function migrar(): Promise<void> {
  const { default: dataSource } = await import('../../src/database/data-source.js');
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}

/**
 * Vacia las tablas entre casos.
 *
 * TRUNCATE y no DELETE: reinicia tambien las secuencias y es mucho mas rapido
 * cuando se repite en cada prueba.
 */
export async function vaciarTablas(): Promise<void> {
  const cliente = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: BD_DE_PRUEBAS,
  });
  await cliente.connect();
  await cliente.query(`
    TRUNCATE
      "ejercicios"."criterios_rubrica",
      "ejercicios"."ejercicio_versiones",
      "ejercicios"."ejercicios",
      "vacantes"."vacante_candidatos",
      "vacantes"."vacante_ejercicios",
      "vacantes"."vacantes",
      "autenticacion"."usuarios"
    RESTART IDENTITY CASCADE
  `);
  await cliente.end();
}
