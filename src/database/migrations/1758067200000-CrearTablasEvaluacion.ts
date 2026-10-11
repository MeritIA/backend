import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Resultados de la evaluacion con IA (paquete 4.5).
 *
 * QUE SE GUARDA Y POR QUE
 *
 * El criterio del paquete exige que "el resultado se persista junto con la
 * version de rubrica aplicada". Por eso la evaluacion guarda `id_version`: la
 * rubrica puede cambiar manana, y una nota tiene que poder explicarse con el
 * texto exacto contra el que se califico.
 *
 * Una fila por criterio, no un JSON: el reporte del paquete 5.1 pide el
 * desglose y la evidencia, y ordenar o promediar criterios dentro de un JSON
 * es justo lo que una base relacional ya sabe hacer.
 *
 * UNA EVALUACION POR ENTREGA
 *
 * El indice unico sobre `id_entrega` es lo que hace idempotente al worker: si
 * un trabajo se reintenta despues de haber guardado, la segunda insercion
 * choca en vez de duplicar la nota.
 */
export class CrearTablasEvaluacion1758067200000 implements MigrationInterface {
  name = 'CrearTablasEvaluacion1758067200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "evaluacion"."evaluaciones" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_entrega"    uuid NOT NULL,
        "id_vacante"    uuid NOT NULL,
        "id_candidato"  uuid NOT NULL,
        "id_empresa"    uuid NOT NULL,
        "id_ejercicio"  uuid NOT NULL,
        "id_version"    uuid NOT NULL,
        "nota_final"    numeric(5,2) NOT NULL,
        "proveedor"     varchar(40) NOT NULL,
        "modelo"        varchar(80) NOT NULL,
        "archivos"      int NOT NULL,
        "creada_en"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_evaluacion_nota" CHECK ("nota_final" >= 0 AND "nota_final" <= 100)
      )
    `);
    // Idempotencia: una entrega evaluada no se evalua dos veces.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_evaluacion_entrega" ON "evaluacion"."evaluaciones" ("id_entrega")`,
    );
    // El reporte por vacante (5.1) y el aislamiento por empresa.
    await queryRunner.query(
      `CREATE INDEX "ix_evaluaciones_vacante" ON "evaluacion"."evaluaciones" ("id_vacante", "creada_en" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_evaluaciones_empresa" ON "evaluacion"."evaluaciones" ("id_empresa")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_evaluaciones_candidato" ON "evaluacion"."evaluaciones" ("id_candidato")`,
    );

    await queryRunner.query(`
      CREATE TABLE "evaluacion"."calificaciones_criterio" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_evaluacion"  uuid NOT NULL REFERENCES "evaluacion"."evaluaciones"("id") ON DELETE CASCADE,
        "orden"          int NOT NULL,
        "criterio"       varchar(120) NOT NULL,
        "puntaje"        numeric(6,2) NOT NULL,
        "escala_maxima"  numeric(6,2) NOT NULL,
        "peso"           numeric(5,2) NOT NULL,
        "evidencia"      text NOT NULL,
        CONSTRAINT "ck_calificacion_puntaje" CHECK ("puntaje" >= 0 AND "puntaje" <= "escala_maxima"),
        CONSTRAINT "ck_calificacion_evidencia" CHECK (length(btrim("evidencia")) > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_calificacion_criterio" ON "evaluacion"."calificaciones_criterio" ("id_evaluacion", "criterio")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_calificaciones_evaluacion" ON "evaluacion"."calificaciones_criterio" ("id_evaluacion", "orden")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "evaluacion"."calificaciones_criterio"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "evaluacion"."evaluaciones"`);
  }
}
