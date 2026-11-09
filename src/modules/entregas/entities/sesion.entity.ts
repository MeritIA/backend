import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** La ventana de tiempo de un candidato en un ejercicio cronometrado. */
@Entity({ schema: 'entregas', name: 'sesiones' })
export class Sesion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @Column({ type: 'uuid', name: 'id_candidato' })
  idCandidato!: string;

  @Column({ type: 'uuid', name: 'id_ejercicio' })
  idEjercicio!: string;

  /** Copia de la duracion con la que arranco: una version nueva no la mueve. */
  @Column({ type: 'int', name: 'duracion_minutos' })
  duracionMinutos!: number;

  @Column({ type: 'timestamptz', name: 'iniciada_en', default: () => 'now()' })
  iniciadaEn!: Date;

  @Column({ type: 'timestamptz', name: 'vence_en' })
  venceEn!: Date;
}
