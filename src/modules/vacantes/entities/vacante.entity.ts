import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EstadoVacante } from '../dominio/estado-vacante.js';
// `import type` y relaciones declaradas por nombre: las entidades hijas si
// importan Vacante como valor (lo necesitan para su @ManyToOne), asi que si
// esta la importara a ellas habria un ciclo, y en ESM eso falla al arrancar con
// "Cannot access 'Vacante' before initialization".
import type { VacanteEjercicio } from './vacante-ejercicio.entity.js';
import type { VacanteCandidato } from './vacante-candidato.entity.js';

/** Oferta de trabajo publicada por un reclutador. Vive en el esquema `vacantes`. */
@Entity({ schema: 'vacantes', name: 'vacantes' })
export class Vacante {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  titulo!: string;

  @Column({ type: 'text' })
  descripcion!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  ubicacion!: string | null;

  /**
   * Intentos que cada candidato tiene por ejercicio. Por omision 1: dar mas
   * oportunidades es una decision explicita del reclutador.
   */
  @Column({ type: 'int', name: 'intentos_permitidos', default: 1 })
  intentosPermitidos!: number;

  @Column({
    type: 'enum',
    enum: EstadoVacante,
    enumName: 'estado_vacante',
    default: EstadoVacante.Borrador,
  })
  estado!: EstadoVacante;

  /**
   * Reclutador dueno de la vacante.
   *
   * Se guarda el identificador y NO una relacion con la entidad Usuario: esa
   * vive en el modulo de autenticacion y las fronteras del monolito prohiben
   * alcanzarla desde aqui. Tampoco hay clave foranea entre esquemas, para que
   * las migraciones de cada modulo avancen por separado.
   */
  @Index('ix_vacantes_reclutador')
  @Column({ type: 'uuid', name: 'id_reclutador' })
  idReclutador!: string;

  /**
   * Empresa dueña de la vacante. Se copia del reclutador al crearla y no
   * cambia: es la frontera que impide que una empresa vea los datos de otra.
   */
  @Index('ix_vacantes_empresa')
  @Column({ type: 'uuid', name: 'id_empresa' })
  idEmpresa!: string;

  @OneToMany('VacanteEjercicio', 'vacante', { cascade: true })
  ejercicios!: VacanteEjercicio[];

  @OneToMany('VacanteCandidato', 'vacante', { cascade: true })
  candidatos!: VacanteCandidato[];

  @Column({ type: 'timestamptz', name: 'publicada_en', nullable: true })
  publicadaEn!: Date | null;

  @Column({ type: 'timestamptz', name: 'cerrada_en', nullable: true })
  cerradaEn!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizada_en' })
  actualizadaEn!: Date;
}
