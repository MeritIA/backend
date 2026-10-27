import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sector y NIT de la empresa cliente.
 *
 * POR QUE AHORA
 *
 * Dos fuentes independientes piden lo mismo. La pantalla A01 ("verificar
 * empresa") tiene los dos campos en el formulario de registro. Y el feedback
 * del review del 26/10 pregunta "que tipo de empresas, cuantas convocatorias al
 * ano por empresa, ejemplo sector financiero": sin `sector` esa pregunta no se
 * puede contestar con una consulta, solo con una diapositiva.
 *
 * EL SECTOR ES UN ENUM, NO TEXTO LIBRE
 *
 * Porque existe para agrupar. Con texto libre, "Financiero", "finanzas" y
 * "banca" serian tres sectores y el informe saldria vacio. La lista esta en
 * `dominio/sector.ts` y NO esta ratificada por ningun documento del proyecto:
 * queda anotada en la Declaracion de Alcance. Anadir una entrada es un
 * `ALTER TYPE ... ADD VALUE`.
 *
 * Con DEFAULT 'otro' y NOT NULL: las filas que existen antes de esta columna
 * tienen que valer algo, y las fixtures de prueba insertan solo el nombre. El
 * DTO de la API si lo exige, que es donde importa que alguien clasifique.
 *
 * EL NIT ES OPCIONAL Y UNICO
 *
 * Opcional porque la verificacion contra la Camara de Comercio que pide A01 no
 * existe, y exigir un dato que no se puede contrastar da una sensacion de
 * validez que el sistema no respalda. Unico porque dos empresas con el mismo
 * NIT son la misma empresa dos veces, y entonces sus vacantes y sus informes
 * quedarian partidos en dos.
 *
 * El indice unico es PARCIAL (`where nit is not null`). Sin eso, en PostgreSQL
 * varios NULL no chocan entre si —asi que funcionaria igual—, pero el indice
 * cargaria todas las empresas sin NIT sin necesidad. Se declara parcial para
 * que diga lo que quiere decir: la unicidad aplica a los NIT declarados.
 *
 * El digito de verificacion NO se comprueba en la base. Es aritmetica sobre los
 * digitos, y ponerla en un CHECK significaria mantener el algoritmo de la DIAN
 * escrito dos veces, en SQL y en TypeScript, con la garantia de que uno de los
 * dos se queda viejo. Vive en `dominio/nit.ts`, con pruebas contra NIT publicos.
 */
export class AnadirSectorYNitAEmpresas1761609600000 implements MigrationInterface {
  name = 'AnadirSectorYNitAEmpresas1761609600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "autenticacion"."sector_empresa" AS ENUM (
        'financiero', 'tecnologia', 'salud', 'educacion', 'industria',
        'comercio', 'servicios', 'construccion', 'agro', 'transporte',
        'energia', 'telecomunicaciones', 'gobierno', 'otro'
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "autenticacion"."empresas"
        ADD COLUMN "sector" "autenticacion"."sector_empresa" NOT NULL DEFAULT 'otro',
        ADD COLUMN "nit" varchar(20)
    `);

    // Para el informe por sector: agrupa sin recorrer la tabla entera.
    await queryRunner.query(`
      CREATE INDEX "ix_empresas_sector" ON "autenticacion"."empresas" ("sector")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_empresas_nit"
        ON "autenticacion"."empresas" ("nit")
        WHERE "nit" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "autenticacion"."ux_empresas_nit"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "autenticacion"."ix_empresas_sector"`);
    await queryRunner.query(`
      ALTER TABLE "autenticacion"."empresas"
        DROP COLUMN IF EXISTS "nit",
        DROP COLUMN IF EXISTS "sector"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "autenticacion"."sector_empresa"`);
  }
}
