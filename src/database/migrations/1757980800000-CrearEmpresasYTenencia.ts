import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Empresas y aislamiento de datos por empresa.
 *
 * POR QUE
 *
 * El criterio de aceptacion del paquete 5.1 exige que "ningun reporte muestre
 * datos de una empresa distinta a la del reclutador autenticado". Hasta ahora
 * el backend no tenia el concepto de empresa: las vacantes y los ejercicios
 * pertenecian a un reclutador suelto, asi que dos reclutadores de la misma
 * empresa no podian compartir nada, y la frontera entre empresas no existia
 * como dato sino como coincidencia.
 *
 * DONDE VIVE
 *
 * En el esquema `autenticacion`, junto a los usuarios: la empresa es parte de
 * la identidad de quien entra. Crear un septimo modulo contradiria la
 * arquitectura de seis aprobada en el paquete 1.4.
 *
 * QUIEN TIENE EMPRESA
 *
 * - Reclutador: siempre. Sin empresa no se sabria a quien pertenece lo que crea.
 * - Candidato: nunca. Es una persona externa invitada a una vacante.
 * - Administrador: opcional. Con empresa es administrador de esa empresa; sin
 *   ella, de la plataforma.
 *
 * Las tres reglas quedan como CHECK en la base, no solo en el codigo.
 *
 * DATOS EXISTENTES
 *
 * En una base que ya tenga vacantes o ejercicios se crea una empresa
 * "pendiente de asignar" y se les asigna, para poder poner la columna NOT NULL
 * sin perder nada. En una base nueva no se crea ninguna.
 */
export class CrearEmpresasYTenencia1757980800000 implements MigrationInterface {
  name = 'CrearEmpresasYTenencia1757980800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "autenticacion"."empresas" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "nombre"         varchar(160) NOT NULL,
        "activa"         boolean NOT NULL DEFAULT true,
        "creada_en"      timestamptz NOT NULL DEFAULT now(),
        "actualizada_en" timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Unico sin distinguir mayusculas: "Acme" y "ACME" serian la misma empresa
    // escrita por dos personas distintas.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_empresas_nombre" ON "autenticacion"."empresas" (lower("nombre"))`,
    );

    // La clave foranea SI existe aqui: empresa y usuario viven en el mismo
    // esquema y son del mismo modulo. Entre esquemas se siguen guardando solo
    // identificadores.
    await queryRunner.query(`
      ALTER TABLE "autenticacion"."usuarios"
        ADD COLUMN "id_empresa" uuid NULL REFERENCES "autenticacion"."empresas"("id")
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_usuarios_empresa" ON "autenticacion"."usuarios" ("id_empresa")`,
    );

    await queryRunner.query(`ALTER TABLE "vacantes"."vacantes" ADD COLUMN "id_empresa" uuid NULL`);
    await queryRunner.query(
      `ALTER TABLE "ejercicios"."ejercicios" ADD COLUMN "id_empresa" uuid NULL`,
    );

    // La empresa de lo ya creado sale de quien lo creo.
    await queryRunner.query(`
      UPDATE "vacantes"."vacantes" v
         SET "id_empresa" = u."id_empresa"
        FROM "autenticacion"."usuarios" u
       WHERE u."id" = v."id_reclutador"
    `);
    await queryRunner.query(`
      UPDATE "ejercicios"."ejercicios" e
         SET "id_empresa" = u."id_empresa"
        FROM "autenticacion"."usuarios" u
       WHERE u."id" = e."id_autor"
    `);

    // Lo que quede sin empresa (reclutadores previos a esta migracion, o filas
    // cuyo autor ya no existe) va a una empresa de traspaso, que solo se crea
    // si hace falta.
    await queryRunner.query(`
      DO $$
      DECLARE id_traspaso uuid;
      BEGIN
        IF EXISTS (SELECT 1 FROM "autenticacion"."usuarios" WHERE "rol" = 'reclutador' AND "id_empresa" IS NULL)
           OR EXISTS (SELECT 1 FROM "vacantes"."vacantes" WHERE "id_empresa" IS NULL)
           OR EXISTS (SELECT 1 FROM "ejercicios"."ejercicios" WHERE "id_empresa" IS NULL) THEN

          INSERT INTO "autenticacion"."empresas" ("nombre")
          VALUES ('Empresa pendiente de asignar (migracion)')
          RETURNING "id" INTO id_traspaso;

          UPDATE "autenticacion"."usuarios" SET "id_empresa" = id_traspaso
           WHERE "rol" = 'reclutador' AND "id_empresa" IS NULL;
          UPDATE "vacantes"."vacantes" SET "id_empresa" = id_traspaso WHERE "id_empresa" IS NULL;
          UPDATE "ejercicios"."ejercicios" SET "id_empresa" = id_traspaso WHERE "id_empresa" IS NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "vacantes"."vacantes" ALTER COLUMN "id_empresa" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ejercicios"."ejercicios" ALTER COLUMN "id_empresa" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_vacantes_empresa" ON "vacantes"."vacantes" ("id_empresa")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_ejercicios_empresa" ON "ejercicios"."ejercicios" ("id_empresa")`,
    );

    // La regla de quien tiene empresa, en la base y no solo en el codigo.
    await queryRunner.query(`
      ALTER TABLE "autenticacion"."usuarios"
        ADD CONSTRAINT "ck_usuario_empresa" CHECK (
          ("rol" = 'reclutador'    AND "id_empresa" IS NOT NULL) OR
          ("rol" = 'candidato'     AND "id_empresa" IS NULL)     OR
          ("rol" = 'administrador')
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "autenticacion"."usuarios" DROP CONSTRAINT IF EXISTS "ck_usuario_empresa"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "ejercicios"."ix_ejercicios_empresa"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "vacantes"."ix_vacantes_empresa"`);
    await queryRunner.query(
      `ALTER TABLE "ejercicios"."ejercicios" DROP COLUMN IF EXISTS "id_empresa"`,
    );
    await queryRunner.query(`ALTER TABLE "vacantes"."vacantes" DROP COLUMN IF EXISTS "id_empresa"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "autenticacion"."ix_usuarios_empresa"`);
    await queryRunner.query(
      `ALTER TABLE "autenticacion"."usuarios" DROP COLUMN IF EXISTS "id_empresa"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "autenticacion"."empresas"`);
  }
}
