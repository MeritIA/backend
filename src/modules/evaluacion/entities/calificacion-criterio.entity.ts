import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Evaluacion } from './evaluacion.entity.js';

/** `numeric` de PostgreSQL llega como cadena; se convierte a numero al leer. */
const comoNumero = {
  to: (v: number) => v,
  from: (v: string | null) => (v === null ? 0 : Number(v)),
};

/**
 * Nota de un criterio, con la evidencia que la sustenta.
 *
 * Una fila por criterio y no un JSON: el reporte del paquete 5.1 pide el
 * desglose, y ordenar o promediar criterios es justo lo que una base
 * relacional ya sabe hacer.
 */
@Entity({ schema: 'evaluacion', name: 'calificaciones_criterio' })
@Index('ix_calificaciones_evaluacion', ['idEvaluacion', 'orden'])
export class CalificacionCriterio {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_evaluacion' })
  idEvaluacion!: string;

  @ManyToOne(() => Evaluacion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_evaluacion' })
  evaluacion!: Relation<Evaluacion>;

  /** Posicion en la rubrica, para mostrarlos como los definio el reclutador. */
  @Column({ type: 'int' })
  orden!: number;

  @Column({ type: 'varchar', length: 120 })
  criterio!: string;

  @Column({ type: 'numeric', precision: 6, scale: 2, transformer: comoNumero })
  puntaje!: number;

  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    name: 'escala_maxima',
    transformer: comoNumero,
  })
  escalaMaxima!: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: comoNumero })
  peso!: number;

  /** Por que ese puntaje. La base exige que no venga vacia. */
  @Column({ type: 'text' })
  evidencia!: string;
}
