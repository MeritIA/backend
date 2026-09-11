import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del modulo de vacantes.
 *
 * NO hay claves foraneas hacia los esquemas `autenticacion` ni `ejercicios`,
 * aunque se guarden identificadores de usuarios y de ejercicios. Es deliberado:
 * una foranea entre esquemas ata las migraciones de dos modulos y contradice el
 * aislamiento que pide el planteamiento de arquitectura. La existencia de esos
 * recursos la comprueba el servicio preguntando al modulo correspondiente por
 * su interfaz publica.
 */
export class CrearTablasVacantes1757721600000 implements MigrationInterface {
  name = 'CrearTablasVacantes1757721600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "vacantes"."estado_vacante" AS ENUM ('borrador', 'publicada', 'cerrada');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE "vacantes"."vacantes" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "titulo"          varchar(160) NOT NULL,
        "descripcion"     text         NOT NULL,
        "ubicacion"       varchar(120) NULL,
        "estado"          "vacantes"."estado_vacante" NOT NULL DEFAULT 'borrador',
        "id_reclutador"   uuid         NOT NULL,
        "publicada_en"    timestamptz  NULL,
        "cerrada_en"      timestamptz  NULL,
        "creada_en"       timestamptz  NOT NULL DEFAULT now(),
        "actualizada_en"  timestamptz  NOT NULL DEFAULT now()
      )
    `);

    // El listado del reclutador filtra por dueno y ordena por fecha.
    await queryRunner.query(
      `CREATE INDEX "ix_vacantes_reclutador" ON "vacantes"."vacantes" ("id_reclutador", "creada_en" DESC)`,
    );
    // El del candidato filtra por estado.
    await queryRunner.query(
      `CREATE INDEX "ix_vacantes_estado" ON "vacantes"."vacantes" ("estado")`,
    );

    await queryRunner.query(`
      CREATE TABLE "vacantes"."vacante_ejercicios" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_vacante"   uuid NOT NULL REFERENCES "vacantes"."vacantes"("id") ON DELETE CASCADE,
        "id_ejercicio" uuid NOT NULL,
        "orden"        int  NOT NULL DEFAULT 0
      )
    `);
    // Un mismo ejercicio no se asocia dos veces a la misma vacante. La garantia
    // es de la base de datos: dos peticiones simultaneas pasarian cualquier
    // comprobacion previa hecha solo en el codigo.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_vacante_ejercicio" ON "vacantes"."vacante_ejercicios" ("id_vacante", "id_ejercicio")`,
    );

    await queryRunner.query(`
      CREATE TABLE "vacantes"."vacante_candidatos" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_vacante"   uuid NOT NULL REFERENCES "vacantes"."vacantes"("id") ON DELETE CASCADE,
        "id_candidato" uuid NOT NULL,
        "asignado_en"  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_vacante_candidato" ON "vacantes"."vacante_candidatos" ("id_vacante", "id_candidato")`,
    );
    // El listado del candidato busca por su identificador.
    await queryRunner.query(
      `CREATE INDEX "ix_vacante_candidatos_candidato" ON "vacantes"."vacante_candidatos" ("id_candidato")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vacantes"."vacante_candidatos"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vacantes"."vacante_ejercicios"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vacantes"."vacantes"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vacantes"."estado_vacante"`);
  }
}
