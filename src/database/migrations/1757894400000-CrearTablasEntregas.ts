import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del modulo de entregas, y el limite de intentos en las vacantes.
 *
 * El limite vive en la vacante porque es una regla del proceso de seleccion,
 * no de la entrega. Por omision 1: comparar candidatos con el mismo criterio es
 * la razon de ser del producto, y dar mas oportunidades es una decision
 * explicita del reclutador.
 */
export class CrearTablasEntregas1757894400000 implements MigrationInterface {
  name = 'CrearTablasEntregas1757894400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        ADD COLUMN "intentos_permitidos" int NOT NULL DEFAULT 1,
        ADD CONSTRAINT "ck_vacante_intentos" CHECK ("intentos_permitidos" BETWEEN 1 AND 10)
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "entregas"."estado_entrega" AS ENUM ('recibida', 'en_evaluacion', 'evaluada', 'fallida');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE "entregas"."entregas" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_vacante"     uuid NOT NULL,
        "id_candidato"   uuid NOT NULL,
        "id_ejercicio"   uuid NOT NULL,
        "numero_intento" int  NOT NULL,
        "estado"         "entregas"."estado_entrega" NOT NULL DEFAULT 'recibida',
        "archivo_clave"  text NOT NULL,
        "archivo_bytes"  int  NOT NULL,
        "archivo_sha256" char(64) NOT NULL,
        "archivo_tipo"   varchar(100) NOT NULL,
        "archivo_nombre" text NOT NULL,
        "creada_en"      timestamptz NOT NULL DEFAULT now(),
        "actualizada_en" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_entrega_intento_positivo" CHECK ("numero_intento" >= 1),
        CONSTRAINT "ck_entrega_bytes_positivos"  CHECK ("archivo_bytes" > 0)
      )
    `);

    // La red de seguridad del limite de intentos: dos subidas simultaneas que
    // calcularan el mismo numero de intento no pueden guardarse las dos.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_entrega_intento"
        ON "entregas"."entregas" ("id_vacante", "id_candidato", "id_ejercicio", "numero_intento")
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_entregas_candidato" ON "entregas"."entregas" ("id_candidato", "creada_en" DESC)`,
    );
    // El listado del reclutador filtra por vacante y estado.
    await queryRunner.query(
      `CREATE INDEX "ix_entregas_vacante_estado" ON "entregas"."entregas" ("id_vacante", "estado")`,
    );

    await queryRunner.query(`
      CREATE TABLE "entregas"."historial_estados" (
        "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_entrega" uuid NOT NULL REFERENCES "entregas"."entregas"("id") ON DELETE CASCADE,
        "desde"      "entregas"."estado_entrega" NULL,
        "hacia"      "entregas"."estado_entrega" NOT NULL,
        "motivo"     varchar(300) NULL,
        "momento"    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_historial_entrega" ON "entregas"."historial_estados" ("id_entrega", "momento")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "entregas"."historial_estados"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "entregas"."entregas"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "entregas"."estado_entrega"`);
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        DROP CONSTRAINT IF EXISTS "ck_vacante_intentos",
        DROP COLUMN IF EXISTS "intentos_permitidos"
    `);
  }
}
