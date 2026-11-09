import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vocabulario de habilidades: nombres canonicos y sus alias.
 *
 * POR QUE
 *
 * `criterios_rubrica.nombre` es texto libre, asi que para el calculo de
 * afinidad "Claridad del codigo" y "Legibilidad" eran dos habilidades
 * distintas. Era el limite conocido del ADR-0016 y esto lo cierra: un catalogo
 * de plataforma que resuelve cualquiera de las dos a la misma habilidad.
 *
 * DOS TABLAS Y NO UNA COLUMNA DE SINONIMOS
 *
 * Con un `text[]` de alias dentro de `habilidades` no se puede imponer que un
 * termino pertenezca a una sola habilidad, y eso es la regla que sostiene todo:
 * si "claridad" fuera alias de dos, resolverlo seria elegir al azar y el mismo
 * criterio contaria distinto en cada recalculo. Con tabla propia, el unico lo
 * impone la base.
 *
 * LOS UNICOS VAN SOBRE LA CLAVE NORMALIZADA
 *
 * Y no sobre el nombre: "Claridad del codigo" y "claridad del codigo" tienen
 * que chocar, porque son la misma habilidad escrita por dos personas. El
 * servicio normaliza antes de escribir; el indice es lo que lo garantiza.
 *
 * NO HAY UNICO ENTRE LAS DOS TABLAS
 *
 * Que un alias no sea el nombre canonico de otra habilidad lo comprueba el
 * servicio: un indice no puede abarcar dos tablas. Queda dicho aqui para que
 * nadie suponga que la base lo cubre.
 */
export class CrearVocabularioDeHabilidades1762128000000 implements MigrationInterface {
  name = 'CrearVocabularioDeHabilidades1762128000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table ejercicios.habilidades (
        id uuid primary key default gen_random_uuid(),
        nombre varchar(120) not null,
        clave varchar(120) not null,
        descripcion text not null,
        id_autor uuid not null,
        activa boolean not null default true,
        creada_en timestamptz not null default now(),
        actualizada_en timestamptz not null default now()
      )
    `);

    await queryRunner.query(`
      create unique index ux_habilidades_clave on ejercicios.habilidades (clave)
    `);

    await queryRunner.query(`
      create table ejercicios.alias_de_habilidad (
        id uuid primary key default gen_random_uuid(),
        id_habilidad uuid not null references ejercicios.habilidades (id) on delete cascade,
        termino varchar(120) not null,
        clave varchar(120) not null,
        creado_en timestamptz not null default now()
      )
    `);

    // Global y no por habilidad: es la regla que impide que un termino resuelva
    // a dos sitios distintos.
    await queryRunner.query(`
      create unique index ux_alias_de_habilidad_clave on ejercicios.alias_de_habilidad (clave)
    `);

    await queryRunner.query(`
      create index ix_alias_de_habilidad_habilidad on ejercicios.alias_de_habilidad (id_habilidad)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table ejercicios.alias_de_habilidad`);
    await queryRunner.query(`drop table ejercicios.habilidades`);
  }
}
