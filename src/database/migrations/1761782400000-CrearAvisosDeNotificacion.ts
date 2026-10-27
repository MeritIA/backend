import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registro de los avisos por correo a candidatos.
 *
 * POR QUE
 *
 * Decision del 27/10/2026: cerrar una vacante avisa por correo a quienes
 * participaron. Un envio de correo sin tabla seria un disparo al aire: no se
 * podria saber a quien se le escribio, ni recuperar a quien se quedo sin aviso
 * porque el proceso se cayo, ni responder a un reclamo de "a mi nadie me dijo".
 *
 * EL INDICE UNICO ES LA PIEZA IMPORTANTE
 *
 * (id_vacante, id_candidato, tipo) unico es lo que impide el correo duplicado,
 * y lo impide en la base y no en el codigo: dos cierres publicados a la vez, un
 * reenvio manual apretado dos veces o un reinicio a mitad de ronda chocan todos
 * contra la misma restriccion. Una comprobacion en TypeScript tiene siempre una
 * ventana entre el SELECT y el INSERT.
 *
 * ESQUEMA PROPIO Y SIN CLAVES FORANEAS
 *
 * `notificaciones` es su esquema, como cada modulo (ADR 0002). Las columnas
 * guardan identificadores de vacantes y de usuarios sin FK, porque las
 * fronteras del monolito prohiben las claves foraneas entre esquemas de
 * modulos distintos. Lo que se gana es poder mover un modulo a su propia base
 * sin rediseñar nada; lo que se paga es que la integridad de esas referencias
 * la sostienen los servicios.
 *
 * NO SE GUARDA EL CORREO NI EL CUERPO
 *
 * La direccion vive cifrada en el esquema de autenticacion y se pide al enviar.
 * Copiarla aqui la repartiria por la base sin necesidad y multiplicaria por dos
 * el sitio donde hay que acordarse de borrarla cuando alguien ejerza su derecho
 * de supresion.
 */
export class CrearAvisosDeNotificacion1761782400000 implements MigrationInterface {
  name = 'CrearAvisosDeNotificacion1761782400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "notificaciones"`);

    await queryRunner.query(`
      CREATE TYPE "notificaciones"."tipo_de_aviso" AS ENUM ('vacante_cerrada')
    `);

    // 'enviando' es la reserva de la fila: quien gana el UPDATE que la pone es
    // el unico que manda ese correo. Sin ese estado, dos rondas simultaneas
    // escriben dos veces a la misma persona.
    await queryRunner.query(`
      CREATE TYPE "notificaciones"."estado_de_aviso" AS ENUM
        ('pendiente', 'enviando', 'enviada', 'fallida', 'sin_canal')
    `);

    await queryRunner.query(`
      CREATE TABLE "notificaciones"."avisos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "id_vacante" uuid NOT NULL,
        "id_candidato" uuid NOT NULL,
        "tipo" "notificaciones"."tipo_de_aviso" NOT NULL,
        "estado" "notificaciones"."estado_de_aviso" NOT NULL DEFAULT 'pendiente',
        "intentos" integer NOT NULL DEFAULT 0,
        "enviado_en" timestamptz,
        "ultimo_error" text,
        "creado_en" timestamptz NOT NULL DEFAULT now(),
        "actualizado_en" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_avisos" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_avisos_vacante_candidato_tipo"
        ON "notificaciones"."avisos" ("id_vacante", "id_candidato", "tipo")
    `);

    // La consulta de la pantalla y la del reenvio van las dos por vacante.
    await queryRunner.query(`
      CREATE INDEX "ix_avisos_vacante" ON "notificaciones"."avisos" ("id_vacante")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notificaciones"."avisos"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notificaciones"."estado_de_aviso"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notificaciones"."tipo_de_aviso"`);
    // El esquema no se borra: si manana hay otra tabla de notificaciones, este
    // down se la llevaria por delante.
  }
}
