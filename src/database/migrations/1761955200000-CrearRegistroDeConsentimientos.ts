import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registro de consentimientos del titular de los datos (pantallas B12 y B24).
 *
 * POR QUE
 *
 * B12 es el paso 2 de 3 del registro y dice textualmente "Tratamiento de datos
 * conforme a la Ley 1581 de 2012", y B24 promete que cada permiso se revoca
 * "de forma independiente y en cualquier momento". Hasta ahora no habia donde
 * guardar ninguna de las dos cosas: la pantalla prometia un control que no
 * existia.
 *
 * UNA TABLA QUE SOLO CRECE, NO UNA COLUMNA POR PERMISO
 *
 * Con cuatro booleanos en `usuarios` se sabe lo que la persona autoriza hoy y
 * se pierde todo lo demas. La Ley 1581 no pide el estado: pide poder demostrar
 * que se obtuvo el consentimiento, para que finalidad y cuando. Eso es un
 * historial. Revocar inserta una fila con `concedido = false`; el estado
 * actual es la fila mas reciente de cada par (usuario, tipo).
 *
 * Por lo mismo NO hay unico sobre (id_usuario, tipo): habria uno por decision,
 * y la tabla dejaria de poder contar la historia.
 *
 * EL INDICE ES EL DE LA UNICA CONSULTA QUE IMPORTA
 *
 * "La ultima decision de este usuario sobre este permiso". Las tres columnas
 * van en ese orden; cualquier otro obligaria a recorrer filas de mas.
 *
 * SIN CLAVE FORANEA A `usuarios`
 *
 * Estan en el mismo esquema, asi que aqui si seria posible. Se deja fuera a
 * proposito por lo que viene con B24: eliminar la cuenta tiene que poder
 * borrar al usuario y **conservar** la prueba de que un dia consintio, que es
 * justo lo que una FK con borrado en cascada destruiria. Esa decision se toma
 * entera cuando se implemente "eliminar cuenta"; esta tabla no la prejuzga.
 */
export class CrearRegistroDeConsentimientos1761955200000 implements MigrationInterface {
  name = 'CrearRegistroDeConsentimientos1761955200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "autenticacion"."tipo_de_consentimiento" AS ENUM (
        'biometria', 'calificacion_ia', 'perfil_publico', 'mentor_ia'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "autenticacion"."origen_de_consentimiento" AS ENUM ('registro', 'perfil')
    `);

    await queryRunner.query(`
      CREATE TABLE "autenticacion"."consentimientos" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "id_usuario" uuid NOT NULL,
        "tipo" "autenticacion"."tipo_de_consentimiento" NOT NULL,
        "concedido" boolean NOT NULL,
        "version_del_aviso" varchar(20) NOT NULL,
        "origen" "autenticacion"."origen_de_consentimiento" NOT NULL,
        "registrado_en" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_consentimientos_usuario_tipo"
        ON "autenticacion"."consentimientos" ("id_usuario", "tipo", "registrado_en")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "autenticacion"."consentimientos"`);
    await queryRunner.query(`DROP TYPE "autenticacion"."origen_de_consentimiento"`);
    await queryRunner.query(`DROP TYPE "autenticacion"."tipo_de_consentimiento"`);
  }
}
