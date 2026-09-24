import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { EjercicioVersion } from './ejercicio-version.entity.js';

/**
 * Un criterio de la rubrica, con su peso y su escala.
 *
 * Entregable del paquete: "estructura de rubrica por criterios con pesos".
 *
 * El peso dice cuanto aporta el criterio a la nota final; los pesos de una
 * version suman 100. La escala maxima dice sobre cuanto se puntua ese criterio
 * en concreto, porque no todos se miden igual de fino: "compila" es un 0 o 1,
 * mientras que "claridad del codigo" admite una escala de 5.
 *
 * La descripcion no es decorativa: es el texto que el motor de IA recibe como
 * referencia de que significa cada nota. Una descripcion vaga produce
 * calificaciones poco fiables, que es el riesgo declarado del paquete.
 */
@Entity({ schema: 'ejercicios', name: 'criterios_rubrica' })
export class CriterioRubrica {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_version' })
  idVersion!: string;

  @ManyToOne(() => EjercicioVersion, (v) => v.criterios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_version' })
  version!: Relation<EjercicioVersion>;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'text' })
  descripcion!: string;

  /**
   * Aporte a la nota final. Los pesos de una version suman 100.
   *
   * `numeric` y no `float`: en coma flotante binaria, 33,33 no se representa
   * exacto y una rubrica guardada podria dejar de sumar 100 al releerla.
   *
   * El transformador es obligatorio, no cosmetico: el driver de PostgreSQL
   * devuelve `numeric` como CADENA para no perder precision, y sin convertir
   * aqui la suma de pesos seria una concatenacion de textos —"33.33"+"33.33"—
   * que pasaria la validacion sin que nadie se entere.
   */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: {
      to: (valor: number) => valor,
      from: (valor: string | number | null) => (valor === null ? 0 : Number(valor)),
    },
  })
  peso!: number;

  /** Se puntua de 0 a este valor. */
  @Column({ type: 'int', name: 'escala_maxima' })
  escalaMaxima!: number;

  @Column({ type: 'int', default: 0 })
  orden!: number;
}
