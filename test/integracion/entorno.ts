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

/**
 * Base logica de Redis para las pruebas, aparte de la 0 del backend de desarrollo.
 *
 * Los contadores del rate limiting sobreviven entre corridas: un bloqueo que
 * dejo una corrida anterior (de cinco minutos, en el limite de entregas) haria
 * fallar con 429 la siguiente aunque el codigo estuviera bien. Por eso esta
 * base se vacia al empezar, y por eso es otra: vaciar la 0 borraria los
 * contadores de quien este usando la aplicacion.
 */
const BD_REDIS_DE_PRUEBAS = '1';

async function vaciarRedisDePruebas(): Promise<void> {
  const { Redis } = await import('ioredis');
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(BD_REDIS_DE_PRUEBAS),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  // Sin oyente, ioredis imprime "Unhandled error event" antes del mensaje
  // claro de abajo, que es el que dice que hacer.
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.flushdb();
  } catch (e) {
    throw new Error(
      `No se pudo conectar a Redis en ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}.\n` +
        'Levanta el entorno antes de correr estas pruebas:  docker compose up -d\n' +
        `Detalle: ${(e as Error).message}`,
    );
  } finally {
    redis.disconnect();
  }
}

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
  process.env.THROTTLE_SUBMISSION_LIMIT = '100000';
  process.env.THROTTLE_EVALUACION_LIMIT = '100000';
  process.env.REDIS_DB = BD_REDIS_DE_PRUEBAS;
  // El worker de la cola, apagado salvo en la suite que lo prueba: en las
  // demas cambiaria el estado de las entregas por detras de las aserciones.
  process.env.COLA_WORKER_HABILITADO = 'false';
  process.env.COLA_REINTENTOS = '3';
  process.env.COLA_BACKOFF_MS = '20';
  await vaciarRedisDePruebas();

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
/**
 * Las migraciones, leidas del codigo fuente y no de dist/.
 *
 * ESTO TENIA LA CI EN ROJO Y NO SE VEIA EN LOCAL
 *
 * `data-source.ts` declara `migrations: ['dist/database/migrations/*.js']`
 * porque ese data source lo consume la CLI de TypeORM. Las pruebas usaban el
 * mismo, asi que cargaban las migraciones COMPILADAS. En una maquina de
 * desarrollo dist/ existe de cualquier `npm run build` anterior y todo
 * parecia funcionar. En la CI, el trabajo de pruebas no compila —eso pasa en
 * otro trabajo y en otra maquina—, asi que dist/ no existia, runMigrations no
 * encontraba NINGUNA migracion, no fallaba, y las pruebas se estrellaban
 * despues contra tablas que nadie habia creado.
 *
 * Aqui se leen del fuente, que es lo que las pruebas ejecutan de verdad.
 */
type ClaseDeMigracion = new () => object;

function migracionesDelFuente(): ClaseDeMigracion[] {
  const modulos = import.meta.glob('../../src/database/migrations/*.ts', {
    eager: true,
  }) as Record<string, Record<string, unknown>>;

  const clases = Object.values(modulos)
    .flatMap((modulo) => Object.values(modulo))
    .filter((v): v is ClaseDeMigracion => typeof v === 'function');

  // Una lista vacia es justo el fallo que estuvo escondido: sin esto,
  // runMigrations no hace nada y no se queja.
  if (clases.length === 0) {
    throw new Error(
      'No se encontro ninguna migracion en src/database/migrations. ' +
        'Sin migraciones las pruebas fallarian despues contra tablas inexistentes.',
    );
  }
  return clases;
}

export async function migrar(): Promise<void> {
  const { DataSource } = await import('typeorm');
  const { opcionesDeConexion } = await import('../../src/database/data-source.js');

  const dataSource = new DataSource({
    ...opcionesDeConexion(),
    migrations: migracionesDelFuente(),
  });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
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
      "autenticacion"."consentimientos",
      "notificaciones"."avisos",
      "evaluacion"."calificaciones_criterio",
      "evaluacion"."evaluaciones",
      "entregas"."historial_estados",
      "entregas"."entregas",
      "ejercicios"."criterios_rubrica",
      "ejercicios"."ejercicio_versiones",
      "ejercicios"."ejercicios",
      "vacantes"."postulaciones",
      "vacantes"."vacante_candidatos",
      "vacantes"."vacante_ejercicios",
      "vacantes"."vacantes",
      "autenticacion"."usuarios",
      "autenticacion"."empresas"
    RESTART IDENTITY CASCADE
  `);
  await cliente.end();
}
