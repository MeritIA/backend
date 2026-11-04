import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Verificacion de identidad de una entrega: foto de camara o modalidad alterna.
 *
 * Es lo que el permiso «verificacion biometrica» (B12) gobierna. La foto vive
 * en el almacenamiento de objetos; aqui solo su referencia y, sobre todo, CUANDO
 * HAY QUE BORRARLA: `conservar_hasta` es la promesa de 90 dias que el candidato
 * leyo al consentir, y un barrido la cumple.
 *
 * `clave` es nula en la modalidad alterna (no hay foto) y despues de purgar.
 */
export class CrearVerificacionesDeEntrega1762214400000 implements MigrationInterface {
  name = 'CrearVerificacionesDeEntrega1762214400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "entregas"."verificaciones" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "id_entrega" uuid NOT NULL,
        "modalidad" varchar(10) NOT NULL,
        "clave" text,
        "tipo_contenido" varchar(20),
        "bytes" int,
        "sha256" char(64),
        "creada_en" timestamptz NOT NULL DEFAULT now(),
        "conservar_hasta" timestamptz,
        "purgada_en" timestamptz,
        CONSTRAINT "pk_verificaciones" PRIMARY KEY ("id"),
        CONSTRAINT "ux_verificacion_entrega" UNIQUE ("id_entrega"),
        CONSTRAINT "fk_verificacion_entrega" FOREIGN KEY ("id_entrega")
          REFERENCES "entregas"."entregas" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_verificacion_modalidad" CHECK ("modalidad" IN ('camara', 'alterna')),
        CONSTRAINT "ck_verificacion_foto" CHECK (
          ("modalidad" = 'alterna' AND "clave" IS NULL)
          OR ("modalidad" = 'camara' AND ("clave" IS NOT NULL OR "purgada_en" IS NOT NULL))
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_verificaciones_por_vencer"
        ON "entregas"."verificaciones" ("conservar_hasta")
        WHERE "clave" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "entregas"."verificaciones"`);
  }
}
