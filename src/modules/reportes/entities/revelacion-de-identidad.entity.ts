import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Cada vez que alguien reveló la identidad de un candidato del ranking.
 *
 * El ranking muestra alias: revelar es una accion explicita, y una accion que
 * quita una proteccion de privacidad tiene que dejar rastro. Es un registro de
 * EVENTOS —sin restriccion unica— porque una segunda consulta es un segundo
 * acceso y la auditoria quiere verlo.
 *
 * Solo identificadores de otros modulos, nunca sus entidades: las fronteras
 * del monolito valen tambien aqui.
 */
@Entity({ schema: 'reportes', name: 'revelaciones_de_identidad' })
@Index('ix_revelaciones_vacante', ['idVacante', 'reveladaEn'])
@Index('ix_revelaciones_empresa', ['idEmpresa', 'reveladaEn'])
export class RevelacionDeIdentidad {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @Column({ type: 'uuid', name: 'id_candidato' })
  idCandidato!: string;

  /** Empresa dueña de la vacante, para responder la auditoria por empresa. */
  @Column({ type: 'uuid', name: 'id_empresa' })
  idEmpresa!: string;

  /** Quien la revelo. */
  @Column({ type: 'uuid', name: 'id_usuario' })
  idUsuario!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'revelada_en' })
  reveladaEn!: Date;
}
