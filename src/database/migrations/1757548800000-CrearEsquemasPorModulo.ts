import type { MigrationInterface, QueryRunner } from 'typeorm';
import { ESQUEMAS } from '../esquemas.js';

/**
 * Crea un esquema de PostgreSQL por modulo de negocio.
 *
 * Es la primera migracion del proyecto: sin estos esquemas, las entidades de
 * cada modulo no tienen donde vivir.
 */
export class CrearEsquemasPorModulo1757548800000 implements MigrationInterface {
  name = 'CrearEsquemasPorModulo1757548800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const esquema of ESQUEMAS) {
      await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${esquema}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // RESTRICT y no CASCADE a proposito: si un esquema todavia tiene tablas,
    // la reversion falla en vez de borrar datos en silencio.
    for (const esquema of [...ESQUEMAS].reverse()) {
      await queryRunner.query(`DROP SCHEMA IF EXISTS "${esquema}" RESTRICT`);
    }
  }
}
