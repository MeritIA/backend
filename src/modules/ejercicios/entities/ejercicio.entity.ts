import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { EjercicioVersion } from './ejercicio-version.entity.js';

/**
 * Prueba tecnica del banco.
 *
 * Es la IDENTIDAD estable del ejercicio: su nombre y su autor. El contenido que
 * se evalua —enunciado y rubrica— no vive aqui sino en sus versiones, que son
 * inmutables. Asi "el ejercicio de concurrencia en Java" sigue siendo el mismo
 * a lo largo del tiempo aunque su enunciado se haya afinado tres veces, y cada
 * calificacion emitida sigue apuntando al texto exacto que se uso.
 */
@Entity({ schema: 'ejercicios', name: 'ejercicios' })
export class Ejercicio {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  titulo!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  tecnologia!: string | null;

  /** Reclutador que lo creo. Solo el identificador: Usuario es de otro modulo. */
  @Index('ix_ejercicios_autor')
  @Column({ type: 'uuid', name: 'id_autor' })
  idAutor!: string;

  /**
   * Un ejercicio retirado no se puede asociar a vacantes nuevas, pero se
   * conserva: las evaluaciones ya emitidas tienen que seguir siendo auditables.
   */
  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @OneToMany('EjercicioVersion', 'ejercicio', { cascade: true })
  versiones!: EjercicioVersion[];

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizado_en' })
  actualizadoEn!: Date;
}
