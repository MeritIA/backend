import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las dos cifras que las tarjetas de vacante prometen y el backend no tenia.
 *
 * POR QUE
 *
 * La matriz de pantallas (§3, filas A02 y A04) encontro que el panel de la
 * empresa muestra "cierre estimado" en cada tarjeta y que la pantalla de
 * publicacion pide "finalistas a evaluar". Ninguno de los dos existia, asi que
 * eran dos promesas de la interfaz sin nada detras.
 *
 * NINGUNA DE LAS DOS ES UNA REGLA
 *
 * `cierre_estimado` no cierra la vacante y `finalistas_a_evaluar` no limita a
 * quien se invita. Las razones estan en la entidad, al lado de cada columna;
 * aqui basta decir por que eso permite que las dos sean nulas: hay vacantes
 * creadas antes de que estos campos existieran, y rellenarlas con un valor
 * inventado seria dar por planificado algo que nadie planifico.
 *
 * POR QUE NO HAY CHECK DE FECHA FUTURA
 *
 * Se penso `CHECK (cierre_estimado > creada_en)`. Se descarta: una vacante que
 * se paso de su estimado es un hecho que el panel tiene que poder mostrar, y un
 * CHECK ahi convertiria la edicion del titulo de una vacante vencida en un 500.
 * El unico CHECK que se deja es sobre `finalistas_a_evaluar`, porque "cero
 * finalistas" o un negativo no son un plan: son un error de captura.
 *
 * SIN INDICE
 *
 * Ninguna consulta filtra ni ordena por estas columnas: se leen junto con la
 * vacante que ya se busco por empresa o por identificador. Un indice aqui seria
 * escritura mas lenta sin una lectura que lo aproveche.
 */
export class AnadirPlanDeCierreAVacantes1761868800000 implements MigrationInterface {
  name = 'AnadirPlanDeCierreAVacantes1761868800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        ADD COLUMN "cierre_estimado" timestamptz,
        ADD COLUMN "finalistas_a_evaluar" int
    `);

    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        ADD CONSTRAINT "ck_vacantes_finalistas_positivos"
        CHECK ("finalistas_a_evaluar" IS NULL OR "finalistas_a_evaluar" >= 1)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        DROP CONSTRAINT "ck_vacantes_finalistas_positivos"
    `);
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacantes"
        DROP COLUMN "finalistas_a_evaluar",
        DROP COLUMN "cierre_estimado"
    `);
  }
}
