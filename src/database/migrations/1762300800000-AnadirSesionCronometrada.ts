import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sesion cronometrada del lado del servidor (B17).
 *
 * `duracion_minutos` es de la VERSION del ejercicio, no del ejercicio: es parte
 * del enunciado que el candidato acepta, y cambiarla es otra version. Nula
 * significa sin limite, que es como se comportan todos los ejercicios actuales.
 *
 * La sesion nace cuando el candidato la INICIA y vence en `vence_en`, calculado
 * en el servidor: el reloj del navegador solo pinta la cuenta atras, nunca
 * decide. Una por candidato y ejercicio de la vacante: iniciar de nuevo no da
 * otra ventana de tiempo.
 */
export class AnadirSesionCronometrada1762300800000 implements MigrationInterface {
  name = 'AnadirSesionCronometrada1762300800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ejercicios"."ejercicio_versiones"
        ADD COLUMN "duracion_minutos" int,
        ADD CONSTRAINT "ck_version_duracion" CHECK ("duracion_minutos" IS NULL OR "duracion_minutos" BETWEEN 1 AND 600)
    `);
    await queryRunner.query(`
      CREATE TABLE "entregas"."sesiones" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "id_vacante" uuid NOT NULL,
        "id_candidato" uuid NOT NULL,
        "id_ejercicio" uuid NOT NULL,
        "duracion_minutos" int NOT NULL,
        "iniciada_en" timestamptz NOT NULL DEFAULT now(),
        "vence_en" timestamptz NOT NULL,
        CONSTRAINT "pk_sesiones" PRIMARY KEY ("id"),
        CONSTRAINT "ux_sesion_candidato_ejercicio" UNIQUE ("id_vacante", "id_candidato", "id_ejercicio")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "entregas"."sesiones"`);
    await queryRunner.query(`
      ALTER TABLE "ejercicios"."ejercicio_versiones"
        DROP CONSTRAINT "ck_version_duracion", DROP COLUMN "duracion_minutos"
    `);
  }
}
