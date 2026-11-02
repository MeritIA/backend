import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Habilidad } from './habilidad.entity.js';

/**
 * Otra forma de escribir el nombre de una habilidad.
 *
 * "Legibilidad", "Codigo legible" y "Claridad" apuntan todas a la habilidad
 * "Claridad del codigo". Es la pieza que hace que el vocabulario sirva: sin
 * alias, el catalogo solo acertaria cuando el reclutador escribiera exactamente
 * el nombre canonico, que es lo que ya pasaba antes de tenerlo.
 *
 * EL TERMINO ES UNICO EN TODO EL CATALOGO, NO POR HABILIDAD
 *
 * Si "claridad" fuera alias de dos habilidades, resolverlo seria elegir una al
 * azar y el mismo criterio contaria para una habilidad distinta cada vez que se
 * recalcula una afinidad. El unico es global a proposito, y la base lo impone
 * en vez de confiar en el servicio.
 *
 * Y UN ALIAS NO PUEDE SER EL NOMBRE CANONICO DE OTRA HABILIDAD
 *
 * Eso lo comprueba el servicio: la base no puede, porque son dos tablas. Si se
 * permitiera, un nombre resolveria a dos sitios segun por donde se mirara.
 */
@Entity({ schema: 'ejercicios', name: 'alias_de_habilidad' })
export class AliasDeHabilidad {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_habilidad' })
  idHabilidad!: string;

  @ManyToOne(() => Habilidad, (h) => h.alias, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_habilidad' })
  habilidad!: Relation<Habilidad>;

  /** Tal como se escribio, para poder mostrarlo en el catalogo. */
  @Column({ type: 'varchar', length: 120 })
  termino!: string;

  /** Normalizado, y unico en todo el catalogo. Es lo que se compara. */
  @Index('ux_alias_de_habilidad_clave', { unique: true })
  @Column({ type: 'varchar', length: 120 })
  clave!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  creadoEn!: Date;
}
