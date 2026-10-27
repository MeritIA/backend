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

  /**
   * Cuando se registro que a este candidato se le contrato, o `null`.
   *
   * VA EN LA FILA DE LA INVITACION, NO EN LA VACANTE
   *
   * Una convocatoria puede terminar con mas de una persona contratada —la
   * pantalla A04 pide cuantos finalistas evaluar, y nada dice que solo se
   * contrate a uno—, asi que el dato pertenece a la relacion y no a la oferta.
   * De paso, el panel de la empresa cuenta contratados sumando filas en vez de
   * interpretar un estado.
   *
   * La primera fecha es la que cuenta: volver a marcarlo no la mueve, porque es
   * el dato que una auditoria lee.
   */
  @Column({ type: 'timestamptz', name: 'contratado_en', nullable: true })
  contratadoEn!: Date | null;

  /**
   * Quien lo registro. Contratar es la decision con consecuencias economicas
   * del proceso: tiene que saberse quien la tomo, igual que se sabe quien
   * revelo una identidad.
   */
  @Column({ type: 'uuid', name: 'id_usuario_que_contrato', nullable: true })
  idUsuarioQueContrato!: string | null;
}
