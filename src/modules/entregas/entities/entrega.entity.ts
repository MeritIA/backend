import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { columnaCifrada } from '../../../common/cifrado/index.js';
import { EstadoEntrega } from '../dominio/estado-entrega.js';
import type { HistorialEstadoEntrega } from './historial-estado-entrega.entity.js';

/**
 * Un intento de un candidato sobre un ejercicio de una vacante.
 *
 * Guarda la REFERENCIA al archivo, nunca el archivo: el contenido vive en el
 * almacenamiento de objetos (paquete 3.3). Vacante, candidato y ejercicio son
 * identificadores sin clave foranea, como en el resto de modulos: sus entidades
 * pertenecen a otros esquemas.
 */
@Entity({ schema: 'entregas', name: 'entregas' })
@Index('ux_entrega_intento', ['idVacante', 'idCandidato', 'idEjercicio', 'numeroIntento'], {
  unique: true,
})
export class Entrega {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @Index('ix_entregas_candidato')
  @Column({ type: 'uuid', name: 'id_candidato' })
  idCandidato!: string;

  @Column({ type: 'uuid', name: 'id_ejercicio' })
  idEjercicio!: string;

  /** 1, 2, 3... por candidato y ejercicio dentro de la vacante. */
  @Column({ type: 'int', name: 'numero_intento' })
  numeroIntento!: number;

  @Column({ type: 'enum', enum: EstadoEntrega, enumName: 'estado_entrega' })
  estado!: EstadoEntrega;

  @Column({ type: 'text', name: 'archivo_clave' })
  archivoClave!: string;

  @Column({ type: 'int', name: 'archivo_bytes' })
  archivoBytes!: number;

  @Column({ type: 'char', length: 64, name: 'archivo_sha256' })
  archivoSha256!: string;

  @Column({ type: 'varchar', length: 100, name: 'archivo_tipo' })
  archivoTipo!: string;

  /**
   * Nombre con el que el candidato subio el archivo. Cifrado: la gente nombra
   * sus archivos "CV_Ana_Maria_Torres.pdf", y eso es informacion personal.
   */
  @Column({ type: 'text', name: 'archivo_nombre', transformer: columnaCifrada() })
  archivoNombre!: string;

  @OneToMany('HistorialEstadoEntrega', 'entrega')
  historial!: HistorialEstadoEntrega[];

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizada_en' })
  actualizadaEn!: Date;
}
