import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';

/**
 * Opciones de conexion a PostgreSQL.
 *
 * `synchronize` va en false de forma permanente y deliberada. Con synchronize
 * activo TypeORM altera el esquema para que case con las entidades, lo que en
 * produccion puede borrar columnas y datos sin aviso. Toda modificacion
 * estructural pasa por una migracion versionada, como exige el encuadre.
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

    // Las entidades viven dentro de cada modulo, junto a su logica.
    entities: ['dist/modules/**/entities/*.entity.js'],
    migrations: ['dist/database/migrations/*.js'],

    logging: enProduccion ? ['error', 'warn'] : ['error', 'warn', 'migration'],
  };
}

/** DataSource que consume la CLI de TypeORM para generar y correr migraciones. */
export default new DataSource(opcionesDeConexion());
