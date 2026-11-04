import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { CalificacionCriterio } from './calificacion-criterio.entity.js';

export const RIESGOS_DE_INYECCION = ['ninguno', 'bajo', 'medio', 'alto'] as const;
export type RiesgoDeInyeccion = (typeof RIESGOS_DE_INYECCION)[number];

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

  /**
   * La moderacion confirmo una descalificacion: la evaluacion sale del ranking
   * y de las lecturas de la empresa, pero se conserva para el candidato y la
   * auditoria. Solo la mueve el modulo de moderacion.
   */
  @Column({ type: 'boolean', default: false })
  descalificada!: boolean;

  @Column({ type: 'varchar', length: 40 })
  proveedor!: string;

  @Column({ type: 'varchar', length: 80 })
  modelo!: string;

  /** Cuantos archivos de texto se le enviaron al modelo. Sirve para auditar. */
  @Column({ type: 'int' })
  archivos!: number;

  /**
   * Auditoria anti inyeccion (paquete 4.2).
   *
   * El riesgo y las banderas que detecto el servicio de IA, con las versiones
   * de las reglas aplicadas: una nota se puede disputar meses despues, y hay
   * que poder decir con que reglas se marco esta entrega.
   */
  @Column({
    type: 'enum',
    enum: RIESGOS_DE_INYECCION,
    enumName: 'riesgo_inyeccion',
    name: 'riesgo_inyeccion',
    default: 'ninguno',
  })
  riesgoInyeccion!: RiesgoDeInyeccion;

  @Column({ type: 'int', name: 'puntaje_inyeccion', default: 0 })
  puntajeInyeccion!: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  banderas!: { codigo: string; archivo: string; ocurrencias: number }[];

  @Column({ type: 'varchar', length: 20, name: 'version_reglas', default: 'desconocida' })
  versionReglas!: string;

  @Column({ type: 'varchar', length: 20, name: 'version_lista_negra', default: 'desconocida' })
  versionListaNegra!: string;

  /**
   * SHA-256 del texto que se envio al modelo.
   *
   * No se guarda el texto: el original ya esta en el almacenamiento de
   * objetos y duplicarlo seria mantener dos copias de datos personales. El
   * hash permite demostrar que lo enviado fue exactamente eso.
   */
  @Column({ type: 'char', length: 64, name: 'texto_sha256', nullable: true })
  textoSha256!: string | null;

  @OneToMany('CalificacionCriterio', 'evaluacion', { cascade: true })
  criterios!: CalificacionCriterio[];

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;
}
