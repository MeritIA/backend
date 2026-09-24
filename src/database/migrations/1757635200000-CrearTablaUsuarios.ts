import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabla de usuarios del modulo de autenticacion.
 *
 * La restriccion de unicidad va sobre `correo_hash` y no sobre `correo`: este
 * ultimo esta cifrado con IV aleatorio, asi que el mismo correo produce valores
 * distintos y un indice unico sobre el no impediria duplicados.
 *
 * Esa restriccion es ademas la que garantiza de verdad que no haya dos cuentas
 * con el mismo correo. La comprobacion previa en el servicio evita el caso
 * normal, pero dos registros simultaneos la pasan a la vez: la integridad no se
 * resuelve solo desde el codigo.
 */
export class CrearTablaUsuarios1757635200000 implements MigrationInterface {
  name = 'CrearTablaUsuarios1757635200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "autenticacion"."rol_usuario" AS ENUM ('candidato', 'reclutador', 'administrador');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE "autenticacion"."usuarios" (
        "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "correo"               text        NOT NULL,
        "correo_hash"          char(64)    NOT NULL,
        "contrasena_hash"      text        NOT NULL,
        "nombre_completo"      text        NOT NULL,
        "rol"                  "autenticacion"."rol_usuario" NOT NULL,
        "activo"               boolean     NOT NULL DEFAULT true,
        "tokens_validos_desde" timestamptz NULL,
        "creado_en"            timestamptz NOT NULL DEFAULT now(),
        "actualizado_en"       timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_usuarios_correo_hash" ON "autenticacion"."usuarios" ("correo_hash")`,
    );

    // Los listados de administracion filtran por rol entre cuentas activas.
    await queryRunner.query(
      `CREATE INDEX "ix_usuarios_rol_activo" ON "autenticacion"."usuarios" ("rol", "activo")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "autenticacion"."ix_usuarios_rol_activo"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "autenticacion"."ux_usuarios_correo_hash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "autenticacion"."usuarios"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "autenticacion"."rol_usuario"`);
  }
}
