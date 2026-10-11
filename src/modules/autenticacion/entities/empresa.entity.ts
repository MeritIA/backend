import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Empresa cliente de MeritIA.
 *
 * Es la unidad de aislamiento de datos: vacantes, ejercicios, entregas,
 * evaluaciones y reportes pertenecen a una empresa, y nadie ve los de otra.
 * El criterio del paquete 5.1 lo exige para los reportes; se aplica desde la
 * raiz porque un reporte solo puede aislar lo que ya viene aislado.
 *
 * Vive en el esquema `autenticacion` porque la empresa es parte de la identidad
 * de quien entra, y porque la arquitectura aprobada tiene seis modulos: este
 * concepto no justifica un septimo.
 */
@Entity({ schema: 'autenticacion', name: 'empresas' })
export class Empresa {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Unico sin distinguir mayusculas: "Acme" y "ACME" son la misma empresa. */
  @Index('ux_empresas_nombre', { unique: true })
  @Column({ type: 'varchar', length: 160 })
  nombre!: string;

  /**
   * Una empresa inactiva no puede operar, pero no se borra: sus vacantes,
   * entregas y evaluaciones tienen que seguir siendo auditables.
   */
  @Column({ type: 'boolean', default: true })
  activa!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizada_en' })
  actualizadaEn!: Date;
}
