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
import { Vacante } from './vacante.entity.js';

/**
 * Candidato invitado a una vacante.
 *
 * Existe por el tercer criterio de aceptacion del paquete: "un candidato solo
 * consulta las vacantes que le han sido asignadas". Sin esta tabla, un
 * candidato veria el catalogo entero de ofertas de todas las empresas.
 *
 * Ningun documento asigna esta relacion a un modulo concreto. Se coloca en
 * `vacantes` porque la asignacion es un acto del reclutador sobre SU vacante, y
 * el dueno del dato debe ser quien lo produce.
 *
 * Igual que con los ejercicios, se guarda solo el identificador del candidato:
 * la entidad Usuario pertenece al modulo de autenticacion.
 */
@Entity({ schema: 'vacantes', name: 'vacante_candidatos' })
@Index('ux_vacante_candidato', ['idVacante', 'idCandidato'], { unique: true })
export class VacanteCandidato {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @ManyToOne(() => Vacante, (v) => v.candidatos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_vacante' })
  vacante!: Relation<Vacante>;

  @Index('ix_vacante_candidatos_candidato')
  @Column({ type: 'uuid', name: 'id_candidato' })
  idCandidato!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'asignado_en' })
  asignadoEn!: Date;
}
