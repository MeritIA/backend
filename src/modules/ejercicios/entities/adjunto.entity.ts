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
import { EjercicioVersion } from './ejercicio-version.entity.js';

/** Un archivo que acompana el enunciado de una version de ejercicio. */
@Entity({ schema: 'ejercicios', name: 'adjuntos' })
export class Adjunto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_adjuntos_version')
  @Column({ type: 'uuid', name: 'id_version' })
  idVersion!: string;

  @ManyToOne(() => EjercicioVersion, (v) => v.adjuntos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_version' })
  version!: Relation<EjercicioVersion>;

  @Column({ type: 'varchar', length: 200 })
  nombre!: string;

  @Column({ type: 'text' })
  clave!: string;

  @Column({ type: 'int' })
  bytes!: number;

  @Column({ type: 'varchar', length: 100, name: 'tipo_contenido' })
  tipoContenido!: string;

  @Column({ type: 'char', length: 64 })
  sha256!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  creadoEn!: Date;
}
