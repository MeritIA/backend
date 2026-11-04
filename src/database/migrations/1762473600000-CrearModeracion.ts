import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moderacion de evaluaciones (Flujo C): el rol `moderador`, la marca
 * `descalificada` de una evaluacion y la cola de casos.
 *
 * Un caso nace de dos fuentes: una evaluacion con riesgo de inyeccion `alto`
 * (la senal antifraude que el sistema ya calcula) o un muestreo aleatorio de
 * control de calidad. Vence a las 24 h. Una decision `confirmar` descalifica la
 * evaluacion (sale del ranking); `restaurar` la deja o la devuelve. El
 * candidato puede disputar una confirmacion UNA vez, y la disputa la decide otro
 * moderador.
 */
export class CrearModeracion1762473600000 implements MigrationInterface {
  name = 'CrearModeracion1762473600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "autenticacion"."rol_usuario" ADD VALUE IF NOT EXISTS 'moderador'`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluacion"."evaluaciones" ADD COLUMN "descalificada" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "moderacion"`);
    await queryRunner.query(`
      CREATE TABLE "moderacion"."casos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "id_evaluacion" uuid NOT NULL,
        "id_vacante" uuid NOT NULL,
        "id_candidato" uuid NOT NULL,
        "origen" varchar(12) NOT NULL,
        "estado" varchar(12) NOT NULL DEFAULT 'abierto',
        "id_caso_origen" uuid,
        "explicacion_de_la_disputa" varchar(1000),
        "creado_en" timestamptz NOT NULL DEFAULT now(),
        "vence_en" timestamptz NOT NULL,
        "id_moderador" uuid,
        "justificacion" varchar(1000),
        "decidido_en" timestamptz,
        CONSTRAINT "pk_casos" PRIMARY KEY ("id"),
        CONSTRAINT "ck_caso_origen" CHECK ("origen" IN ('antifraude', 'muestreo', 'disputa')),
        CONSTRAINT "ck_caso_estado" CHECK ("estado" IN ('abierto', 'restaurado', 'confirmado')),
        CONSTRAINT "ck_caso_decidido" CHECK (
          ("estado" = 'abierto' AND "decidido_en" IS NULL)
          OR ("estado" <> 'abierto' AND "decidido_en" IS NOT NULL AND "justificacion" IS NOT NULL AND "id_moderador" IS NOT NULL)
        )
      )
    `);
    // Una evaluacion no abre dos casos de la misma fuente, y una confirmacion se disputa una sola vez.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_caso_por_evaluacion_y_origen" ON "moderacion"."casos" ("id_evaluacion", "origen") WHERE "origen" <> 'disputa'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_una_disputa_por_caso" ON "moderacion"."casos" ("id_caso_origen") WHERE "origen" = 'disputa'`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_casos_abiertos" ON "moderacion"."casos" ("vence_en") WHERE "estado" = 'abierto'`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_casos_candidato" ON "moderacion"."casos" ("id_candidato")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "moderacion"."casos"`);
    await queryRunner.query(`ALTER TABLE "evaluacion"."evaluaciones" DROP COLUMN "descalificada"`);
    // Un valor de enum no se quita sin recrear el tipo: se deja, es inofensivo.
  }
}
