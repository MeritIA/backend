import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registro de auditoria anti inyeccion en cada evaluacion (paquete 4.2).
 *
 * QUE SE GUARDA, Y POR QUE NO SE GUARDA EL PROMPT ENTERO
 *
 * El entregable del paquete pide "registro de auditoria con prompt original,
 * prompt sanitizado, banderas de seguridad y respuesta del modelo". Aqui se
 * guardan las banderas, el riesgo, las versiones de las reglas aplicadas y el
 * SHA-256 del texto que se envio. El prompt NO se duplica, y es una decision:
 *
 *  - El original ya esta guardado: es el archivo de la entrega, en el
 *    almacenamiento de objetos, con su propio hash.
 *  - El sanitizado es deterministico: mismo original mas misma version de
 *    reglas da el mismo texto. Por eso se versionan las reglas y la lista
 *    negra, y por eso se guarda el hash: permite demostrar que lo enviado fue
 *    exactamente eso, sin copiar datos personales a una segunda tabla.
 *  - La respuesta del modelo ya esta en la nota y en las calificaciones por
 *    criterio, con su evidencia.
 *
 * Duplicar el texto de la entrega en esta tabla significaria mantener dos
 * copias de informacion personal, cifrar y rotar las dos, y borrar las dos
 * cuando alguien ejerza su derecho de supresion.
 */
export class AnadirSeguridadAEvaluaciones1758153600000 implements MigrationInterface {
  name = 'AnadirSeguridadAEvaluaciones1758153600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "evaluacion"."riesgo_inyeccion" AS ENUM ('ninguno', 'bajo', 'medio', 'alto');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "evaluacion"."evaluaciones"
        ADD COLUMN "riesgo_inyeccion"    "evaluacion"."riesgo_inyeccion" NOT NULL DEFAULT 'ninguno',
        ADD COLUMN "puntaje_inyeccion"   int NOT NULL DEFAULT 0,
        ADD COLUMN "banderas"            jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "version_reglas"      varchar(20) NOT NULL DEFAULT 'desconocida',
        ADD COLUMN "version_lista_negra" varchar(20) NOT NULL DEFAULT 'desconocida',
        ADD COLUMN "texto_sha256"        char(64) NULL,
        ADD CONSTRAINT "ck_evaluacion_puntaje_inyeccion"
          CHECK ("puntaje_inyeccion" BETWEEN 0 AND 100)
    `);

    // El reclutador necesita encontrar rapido lo que hay que revisar a mano, y
    // es una minoria de las filas: indice parcial.
    await queryRunner.query(`
      CREATE INDEX "ix_evaluaciones_marcadas"
        ON "evaluacion"."evaluaciones" ("id_vacante", "puntaje_inyeccion" DESC)
        WHERE "riesgo_inyeccion" <> 'ninguno'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "evaluacion"."ix_evaluaciones_marcadas"`);
    await queryRunner.query(`
      ALTER TABLE "evaluacion"."evaluaciones"
        DROP CONSTRAINT IF EXISTS "ck_evaluacion_puntaje_inyeccion",
        DROP COLUMN IF EXISTS "texto_sha256",
        DROP COLUMN IF EXISTS "version_lista_negra",
        DROP COLUMN IF EXISTS "version_reglas",
        DROP COLUMN IF EXISTS "banderas",
        DROP COLUMN IF EXISTS "puntaje_inyeccion",
        DROP COLUMN IF EXISTS "riesgo_inyeccion"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "evaluacion"."riesgo_inyeccion"`);
  }
}
