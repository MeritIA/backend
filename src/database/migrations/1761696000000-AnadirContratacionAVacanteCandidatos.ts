import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registro de contratacion del candidato en una vacante.
 *
 * POR QUE
 *
 * La pantalla A08 ("contratar y cerrar") es la ultima del flujo de la empresa,
 * y el panel A02 cuenta "contratados" entre sus cuatro cifras. Hasta ahora el
 * backend podia cerrar una vacante pero no decir en que termino: un proceso
 * cuyo resultado no se guarda no se puede auditar ni medir, y medir si las
 * contrataciones salen bien es el argumento del producto.
 *
 * DONDE VA
 *
 * En la fila de la invitacion (`vacante_candidatos`) y no en la vacante. Una
 * convocatoria puede terminar con mas de una persona contratada, y asi el
 * panel cuenta filas en vez de interpretar un estado.
 *
 * DOS COLUMNAS Y NO UN BOOLEANO
 *
 * `contratado_en` responde cuando, que es lo que un informe necesita para
 * medir el tiempo del proceso; un booleano solo diria que si.
 * `id_usuario_que_contrato` responde quien: contratar es la decision con
 * consecuencias economicas del proceso, y tiene que dejar rastro igual que
 * revelar una identidad.
 *
 * Sin clave foranea al usuario: las fronteras del monolito prohiben las FK
 * entre esquemas de modulos distintos.
 *
 * NO HAY CHECK QUE OBLIGUE A LAS DOS JUNTAS
 *
 * Se penso un CHECK de "ambas o ninguna". Se deja fuera porque la unica via de
 * escritura es el servicio, que las pone juntas, y porque un CHECK aqui
 * bloquearia poder registrar contrataciones historicas importadas sin autor
 * conocido si alguna vez hace falta. El indice parcial cuenta lo que importa.
 */
export class AnadirContratacionAVacanteCandidatos1761696000000 implements MigrationInterface {
  name = 'AnadirContratacionAVacanteCandidatos1761696000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacante_candidatos"
        ADD COLUMN "contratado_en" timestamptz,
        ADD COLUMN "id_usuario_que_contrato" uuid
    `);

    // Parcial: el panel pregunta por los contratados, que son pocos. Un indice
    // sobre toda la columna cargaria todas las invitaciones sin contratar.
    await queryRunner.query(`
      CREATE INDEX "ix_vacante_candidatos_contratados"
        ON "vacantes"."vacante_candidatos" ("id_vacante")
        WHERE "contratado_en" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "vacantes"."ix_vacante_candidatos_contratados"`);
    await queryRunner.query(`
      ALTER TABLE "vacantes"."vacante_candidatos"
        DROP COLUMN IF EXISTS "id_usuario_que_contrato",
        DROP COLUMN IF EXISTS "contratado_en"
    `);
  }
}
