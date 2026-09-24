import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas del banco de ejercicios.
 *
 * Las versiones son inmutables por diseno del servicio. La base refuerza lo que
 * puede: el par (ejercicio, numero) es unico, asi que dos versiones no pueden
 * compartir numero aunque se creen a la vez.
 */
export class CrearTablasEjercicios1757808000000 implements MigrationInterface {
  name = 'CrearTablasEjercicios1757808000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ejercicios"."ejercicios" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "titulo"         varchar(160) NOT NULL,
        "tecnologia"     varchar(80)  NULL,
        "id_autor"       uuid         NOT NULL,
        "activo"         boolean      NOT NULL DEFAULT true,
        "creado_en"      timestamptz  NOT NULL DEFAULT now(),
        "actualizado_en" timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_ejercicios_autor" ON "ejercicios"."ejercicios" ("id_autor", "activo")`,
    );

    await queryRunner.query(`
      CREATE TABLE "ejercicios"."ejercicio_versiones" (
        "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_ejercicio"      uuid NOT NULL REFERENCES "ejercicios"."ejercicios"("id") ON DELETE CASCADE,
        "numero"            int  NOT NULL,
        "enunciado"         text NOT NULL,
        "motivo_del_cambio" varchar(300) NULL,
        "id_autor"          uuid NOT NULL,
        "creada_en"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_version_numero_positivo" CHECK ("numero" >= 1)
      )
    `);
    // Dos versiones no comparten numero dentro del mismo ejercicio. Es la
    // garantia real frente a dos reclutadores versionando a la vez: la
    // comprobacion del servicio la pasarian ambos.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_ejercicio_version" ON "ejercicios"."ejercicio_versiones" ("id_ejercicio", "numero")`,
    );

    await queryRunner.query(`
      CREATE TABLE "ejercicios"."criterios_rubrica" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_version"    uuid NOT NULL REFERENCES "ejercicios"."ejercicio_versiones"("id") ON DELETE CASCADE,
        "nombre"        varchar(120)  NOT NULL,
        "descripcion"   text          NOT NULL,
        "peso"          numeric(5,2)  NOT NULL,
        "escala_maxima" int           NOT NULL,
        "orden"         int           NOT NULL DEFAULT 0,
        CONSTRAINT "ck_criterio_peso_positivo"  CHECK ("peso" > 0 AND "peso" <= 100),
        CONSTRAINT "ck_criterio_escala_positiva" CHECK ("escala_maxima" >= 1)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_criterios_version" ON "ejercicios"."criterios_rubrica" ("id_version", "orden")`,
    );
    // Dos criterios de la misma version no pueden llamarse igual: un evaluador
    // no sabria a cual corresponde cada nota.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_criterio_nombre_version" ON "ejercicios"."criterios_rubrica" ("id_version", lower("nombre"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ejercicios"."criterios_rubrica"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ejercicios"."ejercicio_versiones"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ejercicios"."ejercicios"`);
  }
}
