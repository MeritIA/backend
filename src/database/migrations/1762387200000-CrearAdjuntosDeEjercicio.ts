import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Archivos que acompanan un enunciado (el dataset, un esqueleto de proyecto).
 *
 * Cuelgan de la VERSION, no del ejercicio: una version es una unidad cerrada y
 * lo que el candidato recibe tiene que ser lo mismo que se califico. El
 * contenido vive en el almacenamiento de objetos; aqui solo su referencia.
 */
export class CrearAdjuntosDeEjercicio1762387200000 implements MigrationInterface {
  name = 'CrearAdjuntosDeEjercicio1762387200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ejercicios"."adjuntos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "id_version" uuid NOT NULL,
        "nombre" varchar(200) NOT NULL,
        "clave" text NOT NULL,
        "bytes" int NOT NULL,
        "tipo_contenido" varchar(100) NOT NULL,
        "sha256" char(64) NOT NULL,
        "creado_en" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_adjuntos" PRIMARY KEY ("id"),
        CONSTRAINT "fk_adjunto_version" FOREIGN KEY ("id_version")
          REFERENCES "ejercicios"."ejercicio_versiones" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_adjuntos_version" ON "ejercicios"."adjuntos" ("id_version")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ejercicios"."adjuntos"`);
  }
}
