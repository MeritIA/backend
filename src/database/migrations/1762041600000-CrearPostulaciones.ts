import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Postulaciones a vacantes publicadas.
 *
 * POR QUE
 *
 * Hasta ahora un candidato solo veia las vacantes a las que alguien lo invito.
 * La matriz de pantallas lo tiene anotado como contradiccion §6.2: A04 promete
 * que "MeritIA preselecciona por perfil de habilidades e invita solo a los
 * finalistas" y B13 ofrece descubrir vacantes por afinidad, pero quien invita
 * hoy es el reclutador, uno por uno. Esta tabla cierra la mitad que se puede
 * cerrar sin inventar un motor de afinidad: el candidato encuentra la vacante y
 * pide entrar. Ver ADR-0015.
 *
 * TABLA APARTE DE `vacante_candidatos`, NO UN ESTADO MAS
 *
 * `vacante_candidatos` es el permiso para entregar; esto es la peticion, que no
 * da permiso para nada. Si vivieran juntas, cada consulta de autorizacion
 * tendria que distinguir "¿esta fila es un permiso o una solicitud?", y eso es
 * justo donde no se quiere ambiguedad. Aceptar INSERTA en `vacante_candidatos`,
 * asi que el control de acceso sigue mirando un solo sitio.
 *
 * EL UNICO SOBRE (vacante, candidato)
 *
 * Una persona se postula una vez a la misma oferta. Sin el unico, pulsar dos
 * veces el boton deja dos filas y el reclutador ve dos postulantes que son el
 * mismo. Y al reves que en el registro de consentimientos --que es un historial
 * y por eso NO lleva unico-- aqui el estado actual es el unico que significa
 * algo: una postulacion no tiene historia, tiene desenlace.
 *
 * SIN CLAVE FORANEA AL CANDIDATO, CON CLAVE FORANEA A LA VACANTE
 *
 * La vacante esta en este mismo esquema y borrarla debe llevarse sus
 * postulaciones: una solicitud a una oferta que no existe no significa nada.
 * El candidato vive en `autenticacion.usuarios`, otro esquema y otro modulo,
 * asi que se guarda solo el identificador, igual que en el resto de `vacantes`.
 *
 * EL INDICE DEL CANDIDATO
 *
 * Es "las mias", la consulta de la pantalla del candidato. El unico ya sirve
 * para "las de esta vacante" porque la vacante va primera.
 */
export class CrearPostulaciones1762041600000 implements MigrationInterface {
  name = 'CrearPostulaciones1762041600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create type vacantes.estado_postulacion as enum ('en_revision', 'aceptada', 'rechazada')
    `);

    await queryRunner.query(`
      create table vacantes.postulaciones (
        id uuid primary key default gen_random_uuid(),
        id_vacante uuid not null references vacantes.vacantes (id) on delete cascade,
        id_candidato uuid not null,
        estado vacantes.estado_postulacion not null default 'en_revision',
        motivo_del_rechazo varchar(500),
        id_usuario_que_decidio uuid,
        decidida_en timestamptz,
        creada_en timestamptz not null default now()
      )
    `);

    await queryRunner.query(`
      create unique index ux_postulacion_vacante_candidato
        on vacantes.postulaciones (id_vacante, id_candidato)
    `);

    await queryRunner.query(`
      create index ix_postulaciones_candidato on vacantes.postulaciones (id_candidato)
    `);

    // Las reglas que la aplicacion ya exige, tambien en la base. Si manana otro
    // proceso escribe aqui sin pasar por el servicio, un rechazo sin motivo o
    // una decision sin autor siguen siendo imposibles.
    await queryRunner.query(`
      alter table vacantes.postulaciones
        add constraint ck_postulacion_rechazo_con_motivo check (
          (estado = 'rechazada' and motivo_del_rechazo is not null)
          or (estado <> 'rechazada' and motivo_del_rechazo is null)
        )
    `);

    await queryRunner.query(`
      alter table vacantes.postulaciones
        add constraint ck_postulacion_decision_con_autor check (
          (estado = 'en_revision' and id_usuario_que_decidio is null and decidida_en is null)
          or (estado <> 'en_revision' and id_usuario_que_decidio is not null and decidida_en is not null)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table vacantes.postulaciones`);
    await queryRunner.query(`drop type vacantes.estado_postulacion`);
  }
}
