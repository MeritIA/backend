import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Entrega } from './entrega.entity.js';
import { EstadoEntrega } from '../dominio/estado-entrega.js';

/**
 * Cada cambio de estado de una entrega, en orden.
 *
 * Es lo que hace cumplir "el estado de cada intento es consultable Y TRAZABLE":
 * la columna `estado` de la entrega dice donde esta ahora; esta tabla dice por
 * donde paso, cuando y por que. Solo se inserta, nunca se actualiza.
 */
@Entity({ schema: 'entregas', name: 'historial_estados' })
export class HistorialEstadoEntrega {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_entrega' })
  idEntrega!: string;

  @ManyToOne(() => Entrega, (e) => e.historial, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_entrega' })
  entrega!: Relation<Entrega>;

  /** Nulo en el primer registro: la entrega nace en `recibida`. */
  @Column({ type: 'enum', enum: EstadoEntrega, enumName: 'estado_entrega', nullable: true })
  desde!: EstadoEntrega | null;

  @Column({ type: 'enum', enum: EstadoEntrega, enumName: 'estado_entrega' })
  hacia!: EstadoEntrega;

  @Column({ type: 'varchar', length: 300, nullable: true })
  motivo!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  momento!: Date;
}
