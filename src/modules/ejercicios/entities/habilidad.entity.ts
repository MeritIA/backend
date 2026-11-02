import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AliasDeHabilidad } from './alias-de-habilidad.entity.js';

/**
 * Una habilidad del vocabulario, con su nombre canonico.
 *
 * POR QUE UNA TABLA Y NO UN ENUM, AL CONTRARIO QUE EL SECTOR DE UNA EMPRESA
 *
 * `SectorEmpresa` es un enum porque los sectores se pueden enumerar de
 * antemano: hay catorce y se reconocen de un vistazo. Las habilidades no. Cada
 * reclutador escribe los criterios de SU rubrica, y el vocabulario tiene que
 * poder crecer con lo que las empresas escriben de verdad, sin un despliegue y
 * sin un `ALTER TYPE`. Un enum obligaria a adivinar hoy la lista completa de
 * habilidades tecnicas que existiran, y eso no se puede.
 *
 * QUE RESUELVE ESTE VOCABULARIO
 *
 * `criterios_rubrica.nombre` es texto libre. Sin vocabulario, "Claridad del
 * codigo" y "Legibilidad" son dos habilidades distintas para el calculo de
 * afinidad, aunque una persona las juntaria: era el limite conocido del
 * ADR-0016. Este catalogo lo cierra.
 *
 * ES DE PLATAFORMA, NO DE CADA EMPRESA, Y ESO ES EL PUNTO
 *
 * Si cada empresa tuviera su vocabulario, dos empresas que piden lo mismo
 * seguirian midiendo habilidades distintas y el perfil del candidato dejaria de
 * ser transversal, que es justo lo que lo hace valer. Por eso lo administra un
 * administrador de plataforma. El coste es que es un cuello de botella humano,
 * y esta dicho en el ADR-0017.
 *
 * NO SE BORRA, SE RETIRA
 *
 * Una habilidad retirada deja de ofrecerse pero sigue resolviendo los nombres
 * que ya se escribieron: borrarla cambiaria el perfil de los candidatos que ya
 * la tenian, y un perfil que cambia porque alguien edito un catalogo no es
 * auditable.
 */
@Entity({ schema: 'ejercicios', name: 'habilidades' })
export class Habilidad {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * El nombre que se muestra. Se guarda tal como se escribio, con sus acentos
   * y mayusculas: la clave de comparacion es `clave`, no esto.
   */
  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  /**
   * El nombre normalizado, y es lo unico que compara el calculo. Unico: dos
   * habilidades con la misma clave serian la misma habilidad escrita dos veces,
   * y el vocabulario dejaria de resolver nada.
   */
  @Index('ux_habilidades_clave', { unique: true })
  @Column({ type: 'varchar', length: 120 })
  clave!: string;

  /** Que se entiende por esta habilidad. Es lo que evita que dos personas la usen para cosas distintas. */
  @Column({ type: 'text' })
  descripcion!: string;

  /** Quien la creo. Una habilidad cambia el perfil de todo el mundo: se sabe quien la metio. */
  @Column({ type: 'uuid', name: 'id_autor' })
  idAutor!: string;

  /** Una retirada no se ofrece, pero sigue resolviendo lo ya escrito. */
  @Column({ type: 'boolean', default: true })
  activa!: boolean;

  @OneToMany('AliasDeHabilidad', 'habilidad', { cascade: true })
  alias!: AliasDeHabilidad[];

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizada_en' })
  actualizadaEn!: Date;
}
