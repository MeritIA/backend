import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registro de quien revelo la identidad de un candidato, y cuando.
 *
 * El ranking del paquete 5.1 muestra alias y no nombres: el proposito del
 * producto es reducir el sesgo, y los mockups lo instrumentan con "identidad
 * oculta hasta que selecciones a quien contactar". Revelar es entonces una
 * ACCION, y una accion que quita una proteccion tiene que dejar rastro.
 *
 * POR QUE REPORTES PASA A TENER UNA TABLA, SI SE DIJO QUE NO TENDRIA
 *
 * El modulo se construyo sin esquema propio a proposito, y esa decision sigue
 * en pie: lo que se rechazo fue **copiar** las notas, porque una copia se
 * desincroniza y acaba contradiciendo a la evaluacion.
 *
 * Esto es otra cosa: es un dato NUEVO, que no existe en ningun otro modulo y
 * que solo produce reportes. No duplica nada, asi que no puede desincronizarse
 * de nada. Guardarlo aqui es lo coherente; meterlo en otro esquema seria
 * ponerlo donde no pertenece para sostener una regla mal entendida.
 *
 * ES UN REGISTRO DE EVENTOS, NO UN ESTADO
 *
 * Sin restriccion unica por (vacante, candidato, usuario): si el mismo
 * reclutador vuelve a consultar la identidad, eso es un segundo acceso y el
 * registro tiene que mostrarlo. Una tabla de estado diria "ya la vio" y
 * perderia cuantas veces y cuando, que es justo lo que una auditoria mira.
 */
export class CrearRevelacionesDeIdentidad1761523200000 implements MigrationInterface {
  name = 'CrearRevelacionesDeIdentidad1761523200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "reportes"`);

    await queryRunner.query(`
      CREATE TABLE "reportes"."revelaciones_de_identidad" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "id_vacante" uuid NOT NULL,
        "id_candidato" uuid NOT NULL,
        "id_empresa" uuid NOT NULL,
        "id_usuario" uuid NOT NULL,
        "revelada_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_revelaciones_de_identidad" PRIMARY KEY ("id")
      )
    `);

    // Por vacante: es como se lee el informe de auditoria de un proceso.
    await queryRunner.query(`
      CREATE INDEX "ix_revelaciones_vacante"
        ON "reportes"."revelaciones_de_identidad" ("id_vacante", "revelada_en" DESC)
    `);

    // Por empresa: para responder "quien de mi empresa vio que identidades".
    await queryRunner.query(`
      CREATE INDEX "ix_revelaciones_empresa"
        ON "reportes"."revelaciones_de_identidad" ("id_empresa", "revelada_en" DESC)
    `);

    // Sin claves foraneas a vacantes.vacantes ni a autenticacion.usuarios: las
    // fronteras del monolito prohiben las FK entre esquemas de modulos
    // distintos. La integridad se sostiene en el servicio, que solo registra
    // despues de comprobar el acceso a la vacante.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "reportes"."revelaciones_de_identidad"`);
  }
}
