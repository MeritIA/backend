import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type OrigenDeCaso = 'antifraude' | 'muestreo' | 'disputa';
export type EstadoDeCaso = 'abierto' | 'restaurado' | 'confirmado';

/** Plazo para decidir un caso, en horas. */
export const HORAS_DE_SLA = 24;

/** Una evaluacion que un moderador tiene que revisar. */
@Entity({ schema: 'moderacion', name: 'casos' })
export class Caso {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_evaluacion' })
  idEvaluacion!: string;

  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @Column({ type: 'uuid', name: 'id_candidato' })
  idCandidato!: string;

  @Column({ type: 'varchar', length: 12 })
  origen!: OrigenDeCaso;

  @Column({ type: 'varchar', length: 12, default: 'abierto' })
  estado!: EstadoDeCaso;

  /** Solo en una disputa: el caso cuya confirmacion se disputa. */
  @Column({ type: 'uuid', name: 'id_caso_origen', nullable: true })
  idCasoOrigen!: string | null;

  @Column({ type: 'varchar', length: 1000, name: 'explicacion_de_la_disputa', nullable: true })
  explicacionDeLaDisputa!: string | null;

  @Column({ type: 'timestamptz', name: 'creado_en', default: () => 'now()' })
  creadoEn!: Date;

  @Column({ type: 'timestamptz', name: 'vence_en' })
  venceEn!: Date;

  @Column({ type: 'uuid', name: 'id_moderador', nullable: true })
  idModerador!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  justificacion!: string | null;

  @Column({ type: 'timestamptz', name: 'decidido_en', nullable: true })
  decididoEn!: Date | null;
}
