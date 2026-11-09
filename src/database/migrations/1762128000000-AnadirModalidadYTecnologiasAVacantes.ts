import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los dos datos que la pantalla «explorar» muestra y filtra, y que la vacante
 * no guardaba: modalidad y tecnologias.
 *
 * El frontend los inventaba: deducia la modalidad buscando «remot» en la
 * ubicacion y dejaba las tecnologias vacias. Ambos son datos del reclutador, no
 * deducciones.
 *
 * `modalidad` es nula en las vacantes anteriores: rellenarla seria afirmar algo
 * que nadie decidio. `tecnologias` parte vacia por la misma razon.
 */
export class AnadirModalidadYTecnologiasAVacantes1762128000000 implements MigrationInterface {
  name = 'AnadirModalidadYTecnologiasAVacantes1762128000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        ADD COLUMN "modalidad" varchar(12),
        ADD COLUMN "tecnologias" text[] NOT NULL DEFAULT '{}'
    `);
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        ADD CONSTRAINT "ck_vacantes_modalidad"
        CHECK ("modalidad" IS NULL OR "modalidad" IN ('remoto', 'hibrido', 'presencial'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vacantes"."vacantes" DROP CONSTRAINT "ck_vacantes_modalidad"`,
    );
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        DROP COLUMN "tecnologias",
        DROP COLUMN "modalidad"
    `);
  }
}
