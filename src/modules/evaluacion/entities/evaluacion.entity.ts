import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { CalificacionCriterio } from './calificacion-criterio.entity.js';

/**
 * Resultado de evaluar una entrega (paquete 4.5).
 *
 * Guarda `idVersion` porque el criterio del paquete lo exige: la rubrica puede
 * cambiar manana, y una nota tiene que poder explicarse con el texto exacto
 * contra el que se califico.
 *
 * Solo identificadores de otros modulos, nunca sus entidades: las fronteras del
 * monolito valen tambien aqui.
 */
@Entity({ schema: 'evaluacion', name: 'evaluaciones' })
export class Evaluacion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Unico: una entrega tiene como mucho una evaluacion. Es lo que la hace idempotente. */
  @Index('ux_evaluacion_entrega', { unique: true })
  @Column({ type: 'uuid', name: 'id_entrega' })
  idEntrega!: string;

  @Index('ix_evaluaciones_vacante')
  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @Index('ix_evaluaciones_candidato')
  @Column({ type: 'uuid', name: 'id_candidato' })
  idCandidato!: string;

  /** Empresa dueña de la vacante: la frontera de los reportes (paquete 5.1). */
  @Index('ix_evaluaciones_empresa')
  @Column({ type: 'uuid', name: 'id_empresa' })
  idEmpresa!: string;

  @Column({ type: 'uuid', name: 'id_ejercicio' })
  idEjercicio!: string;

  /** Version exacta de la rubrica aplicada. */
  @Column({ type: 'uuid', name: 'id_version' })
  idVersion!: string;

  /**
   * De 0 a 100. `numeric` llega como cadena desde PostgreSQL, asi que se
   * transforma a numero: sin esto, sumar dos notas las concatenaria.
   */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'nota_final',
    transformer: { to: (v: number) => v, from: (v: string | null) => (v === null ? 0 : Number(v)) },
  })
  notaFinal!: number;

  @Column({ type: 'varchar', length: 40 })
  proveedor!: string;

  @Column({ type: 'varchar', length: 80 })
  modelo!: string;

  /** Cuantos archivos de texto se le enviaron al modelo. Sirve para auditar. */
  @Column({ type: 'int' })
  archivos!: number;

  @OneToMany('CalificacionCriterio', 'evaluacion', { cascade: true })
  criterios!: CalificacionCriterio[];

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;
}
