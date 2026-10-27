import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SectorEmpresa } from '../dominio/sector.js';

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
   * Sector economico, de una lista cerrada (ver `dominio/sector.ts`).
   *
   * No es un adorno del formulario: es el campo sin el cual la pregunta
   * "cuantas convocatorias al ano tiene una empresa del sector financiero" se
   * responde en una diapositiva en vez de con el sistema.
   *
   * Tiene valor por omision en la base —`otro`— por las filas anteriores a esta
   * columna y por las fixtures que insertan solo el nombre. La API si lo exige:
   * quien crea una empresa la clasifica.
   */
  @Index('ix_empresas_sector')
  @Column({
    type: 'enum',
    enum: SectorEmpresa,
    enumName: 'sector_empresa',
    default: SectorEmpresa.Otro,
  })
  sector!: SectorEmpresa;

  /**
   * NIT en forma canonica `base-digito`, o `null` si no se declaro.
   *
   * Opcional a proposito. La verificacion contra la Camara de Comercio que pide
   * la pantalla A01 no existe todavia, y exigir un NIT que no se puede
   * contrastar da una sensacion de validez que el sistema no respalda. Cuando
   * se declara si se comprueba el digito de verificacion, y es unico: dos
   * empresas con el mismo NIT son la misma empresa dos veces.
   */
  @Index('ux_empresas_nit', { unique: true, where: 'nit is not null' })
  @Column({ type: 'varchar', length: 20, nullable: true })
  nit!: string | null;

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
