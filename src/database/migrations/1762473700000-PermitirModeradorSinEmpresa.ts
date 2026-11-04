import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Un moderador es personal de la plataforma: no pertenece a ninguna empresa.
 *
 * Va en una migracion aparte de la que agrega el valor `moderador` al enum
 * porque un valor de enum recien agregado no se puede usar en la misma
 * transaccion. La comparacion es como texto por la misma razon: no depende de
 * que el valor ya este visible para esta sesion.
 */
export class PermitirModeradorSinEmpresa1762473700000 implements MigrationInterface {
  name = 'PermitirModeradorSinEmpresa1762473700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "autenticacion"."usuarios" DROP CONSTRAINT "ck_usuario_empresa"`,
    );
    await queryRunner.query(`
      ALTER TABLE "autenticacion"."usuarios"
        ADD CONSTRAINT "ck_usuario_empresa" CHECK (
          ("rol" = 'reclutador'    AND "id_empresa" IS NOT NULL) OR
          ("rol" = 'candidato'     AND "id_empresa" IS NULL)     OR
          ("rol" = 'administrador') OR
          ("rol"::text = 'moderador' AND "id_empresa" IS NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "autenticacion"."usuarios" DROP CONSTRAINT "ck_usuario_empresa"`,
    );
    await queryRunner.query(`
      ALTER TABLE "autenticacion"."usuarios"
        ADD CONSTRAINT "ck_usuario_empresa" CHECK (
          ("rol" = 'reclutador'    AND "id_empresa" IS NOT NULL) OR
          ("rol" = 'candidato'     AND "id_empresa" IS NULL)     OR
          ("rol" = 'administrador')
        )
    `);
  }
}
