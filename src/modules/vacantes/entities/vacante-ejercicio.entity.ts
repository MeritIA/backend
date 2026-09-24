import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Vacante } from './vacante.entity.js';

/**
 * Ejercicio asociado a una vacante.
 *
 * Entregable del paquete 2.2: "relacion vacante-ejercicio persistida en su
 * propio esquema".
 *
 * Se guarda **solo el identificador** del ejercicio, sin clave foranea al
 * esquema `ejercicios` y sin importar su entidad. El riesgo que la ficha del
 * paquete señala es exactamente ese acoplamiento, y la regla de fronteras del
 * lint lo impide en el codigo; aqui se evita tambien en la base de datos, para
 * que las migraciones de los dos modulos no queden atadas.
 *
 * La consecuencia es que la existencia del ejercicio no la garantiza la base de
 * datos: la comprueba el servicio preguntando al modulo de ejercicios por su
 * interfaz publica.
 */
@Entity({ schema: 'vacantes', name: 'vacante_ejercicios' })
@Index('ux_vacante_ejercicio', ['idVacante', 'idEjercicio'], { unique: true })
export class VacanteEjercicio {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @ManyToOne(() => Vacante, (v) => v.ejercicios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_vacante' })
  vacante!: Relation<Vacante>;

  @Column({ type: 'uuid', name: 'id_ejercicio' })
  idEjercicio!: string;

  /** Orden en que el candidato vera los ejercicios. */
  @Column({ type: 'int', default: 0 })
  orden!: number;
}
