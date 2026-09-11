import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Ejercicio } from './ejercicio.entity.js';
import type { CriterioRubrica } from './criterio-rubrica.entity.js';

/**
 * Una version concreta del enunciado y su rubrica.
 *
 * ES INMUTABLE. No existe operacion de edicion: corregir un enunciado significa
 * crear la version siguiente. Esa es la unica forma de cumplir el primer
 * criterio de aceptacion del paquete —"versiona sin afectar entregas ya
 * calificadas con una version anterior"—, porque una calificacion que apunta a
 * la version 2 debe poder mostrar para siempre el texto y los pesos con los que
 * se emitio.
 *
 * Si las versiones fueran editables, una nota del mes pasado podria acabar
 * justificada por una rubrica que no existia cuando se calculo.
 */
@Entity({ schema: 'ejercicios', name: 'ejercicio_versiones' })
@Index('ux_ejercicio_version', ['idEjercicio', 'numero'], { unique: true })
export class EjercicioVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_ejercicio' })
  idEjercicio!: string;

  @ManyToOne(() => Ejercicio, (e) => e.versiones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_ejercicio' })
  ejercicio!: Relation<Ejercicio>;

  /** Correlativo dentro del ejercicio: 1, 2, 3... */
  @Column({ type: 'int' })
  numero!: number;

  @Column({ type: 'text' })
  enunciado!: string;

  /** Nota que explica que cambio respecto de la version anterior. */
  @Column({ type: 'varchar', length: 300, nullable: true, name: 'motivo_del_cambio' })
  motivoDelCambio!: string | null;

  @OneToMany('CriterioRubrica', 'version', { cascade: true })
  criterios!: CriterioRubrica[];

  /** Quien la creo. */
  @Column({ type: 'uuid', name: 'id_autor' })
  idAutor!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;
}
