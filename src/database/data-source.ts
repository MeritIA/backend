import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';

/**
 * Si la aplicacion aplica sus migraciones pendientes al arrancar.
 *
 * Encendido en desarrollo y produccion; apagado en pruebas, que migran una
 * base propia por su cuenta. `MIGRACIONES_AUTOMATICAS=false` lo apaga donde
 * haga falta, por ejemplo con varias replicas: migrar es una escritura sobre el
 * esquema y dos procesos haciendolo a la vez compiten. Con una sola instancia,
 * que es el despliegue actual, no hay carrera.
 */
export function migracionesAutomaticas(): boolean {
  const explicito = process.env.MIGRACIONES_AUTOMATICAS;
  if (explicito === 'true' || explicito === 'false') return explicito === 'true';
  return process.env.NODE_ENV !== 'test';
}

/**
 * Opciones de conexion a PostgreSQL.
 *
 * `synchronize` va en false de forma permanente y deliberada. Con synchronize
 * activo TypeORM altera el esquema para que case con las entidades, lo que en
 * produccion puede borrar columnas y datos sin aviso. Toda modificacion
 * estructural pasa por una migracion versionada, como exige el encuadre.
 *
 * `migrationsRun` tambien va en false aqui: este objeto lo comparte la CLI, que
 * migra por su cuenta. La aplicacion lo enciende en database.module.ts.
 */
export function opcionesDeConexion(): DataSourceOptions {
  const enProduccion = process.env.NODE_ENV === 'production';

  return {
    type: 'postgres',
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,

    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'migraciones',

    // Este patron lo usa SOLO la CLI de TypeORM, para `migration:generate`,
    // que necesita comparar las entidades contra el esquema. La aplicacion no
    // lo usa: carga sus entidades con autoLoadEntities (ver database.module.ts).
    entities: ['dist/modules/**/entities/*.entity.js'],
    migrations: ['dist/database/migrations/*.js'],

    logging: enProduccion ? ['error', 'warn'] : ['error', 'warn', 'migration'],
  };
}

/** DataSource que consume la CLI de TypeORM para generar y correr migraciones. */
export default new DataSource(opcionesDeConexion());
