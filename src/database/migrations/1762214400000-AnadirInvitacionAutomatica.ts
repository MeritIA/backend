import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Invitacion automatica por afinidad (A04).
 *
 * A04 promete que "MeritIA preselecciona por perfil de habilidades e invita
 * solo a los finalistas". Estas columnas son esa promesa.
 *
 * POR QUE UN CUPO PROPIO Y NO `finalistas_a_evaluar`
 *
 * Era lo tentador: ya hay un numero que dice cuanta gente se piensa evaluar.
 * Pero la decision D-12 dice que `finalistas_a_evaluar` es un **plan y no un
 * tope**, y que no impide invitar ni evaluar a mas gente. Usarlo como maximo la
 * contradiria en silencio. `cupo_de_invitacion_automatica` cuenta SOLO lo que
 * emitio la maquina; el reclutador sigue invitando a mano sin limite.
 *
 * POR QUE SE GUARDA LA AFINIDAD DE CADA DECISION
 *
 * `afinidad_al_decidir` es la unica forma de auditar por que la maquina dijo
 * si. Y hace falta precisamente porque el vocabulario de habilidades se puede
 * editar: si manana alguien une "Legibilidad" con "Claridad del codigo", todas
 * las afinidades cambian --se calculan en vivo, sin copia-- y sin esta columna
 * seria imposible reconstruir con que numero se invito a alguien.
 *
 * Es el mismo criterio que `id_version` en una evaluacion: se guarda contra que
 * se decidio, no solo el resultado.
 *
 * `decision_automatica` SEPARADO DE `id_usuario_que_decidio`
 *
 * Se penso en dejar el usuario a null para marcar lo automatico. Se descarto:
 * una politica la enciende una persona, y esa persona responde por lo que la
 * maquina acepte. Asi que se guardan las dos cosas --que fue automatico, y
 * quien encendio la politica-- y no se pierde el responsable.
 *
 * SIN VALORES POR OMISION QUE ENCIENDAN NADA
 *
 * `invitacion_automatica` nace en false. Una migracion no activa una funcion
 * que decide sobre personas.
 */
export class AnadirInvitacionAutomatica1762214400000 implements MigrationInterface {
  name = 'AnadirInvitacionAutomatica1762214400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table vacantes.vacantes
        add column invitacion_automatica boolean not null default false,
        add column umbral_de_afinidad int,
        add column cupo_de_invitacion_automatica int
    `);

    // El umbral es un porcentaje y el cupo no puede ser negativo. Las dos reglas
    // las valida el DTO; aqui estan para que sigan siendo ciertas si manana algo
    // escribe sin pasar por la API.
    await queryRunner.query(`
      alter table vacantes.vacantes
        add constraint ck_vacante_umbral_es_porcentaje check (
          umbral_de_afinidad is null
          or (umbral_de_afinidad >= 0 and umbral_de_afinidad <= 100)
        ),
        add constraint ck_vacante_cupo_no_negativo check (
          cupo_de_invitacion_automatica is null or cupo_de_invitacion_automatica >= 0
        )
    `);

    await queryRunner.query(`
      alter table vacantes.postulaciones
        add column decision_automatica boolean not null default false,
        add column afinidad_al_decidir numeric(5, 2)
    `);

    // Una decision automatica tiene que estar decidida: no existe una
    // postulacion "en revision" que la maquina ya resolvio.
    await queryRunner.query(`
      alter table vacantes.postulaciones
        add constraint ck_postulacion_automatica_esta_decidida check (
          decision_automatica = false or estado <> 'en_revision'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table vacantes.postulaciones
        drop constraint ck_postulacion_automatica_esta_decidida,
        drop column decision_automatica,
        drop column afinidad_al_decidir
    `);
    await queryRunner.query(`
      alter table vacantes.vacantes
        drop constraint ck_vacante_umbral_es_porcentaje,
        drop constraint ck_vacante_cupo_no_negativo,
        drop column invitacion_automatica,
        drop column umbral_de_afinidad,
        drop column cupo_de_invitacion_automatica
    `);
  }
}
