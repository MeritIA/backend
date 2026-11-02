import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Vacante } from './vacante.entity.js';
import { EstadoPostulacion } from '../dominio/estado-postulacion.js';

/**
 * Un candidato que se postulo por su cuenta a una vacante publicada.
 *
 * NO ES LO MISMO QUE `VacanteCandidato`, Y LA DIFERENCIA IMPORTA
 *
 * `VacanteCandidato` es la INVITACION: el permiso para entregar. Esta tabla es
 * la SOLICITUD, que todavia no da permiso para nada. Se separan porque son dos
 * hechos distintos y con consecuencias distintas:
 *
 *   - Una invitacion puede existir sin postulacion: es el camino que ya habia,
 *     el reclutador invita a quien quiere.
 *   - Una postulacion puede existir sin invitacion, y es el caso normal
 *     mientras esta en revision o si se rechaza.
 *
 * Meterlas en la misma tabla con un estado obligaria a preguntar "¿esta fila es
 * un permiso o una peticion?" en cada consulta de autorizacion, que es
 * exactamente donde no se quiere ambiguedad.
 *
 * ACEPTAR NO SUSTITUYE A LA INVITACION: LA CREA
 *
 * Al aceptar se inserta la fila en `vacante_candidatos`. Asi el control de
 * acceso a las entregas sigue mirando un unico sitio y no aprende un segundo
 * camino, que es como se cuelan los fallos de autorizacion.
 *
 * SE GUARDA SOLO EL IDENTIFICADOR DEL CANDIDATO
 *
 * Igual que en el resto del modulo: la entidad Usuario pertenece a
 * autenticacion. Y tiene una consecuencia de privacidad que conviene saber: la
 * lista de postulantes que ve el reclutador son identificadores, no nombres.
 * Ver el ADR-0015.
 */
@Entity({ schema: 'vacantes', name: 'postulaciones' })
@Index('ux_postulacion_vacante_candidato', ['idVacante', 'idCandidato'], { unique: true })
export class Postulacion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @ManyToOne(() => Vacante, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_vacante' })
  vacante!: Relation<Vacante>;

  /** A quien pertenece la postulacion. Es el filtro de "las mias". */
  @Index('ix_postulaciones_candidato')
  @Column({ type: 'uuid', name: 'id_candidato' })
  idCandidato!: string;

  @Column({
    type: 'enum',
    enum: EstadoPostulacion,
    enumName: 'estado_postulacion',
    default: EstadoPostulacion.EnRevision,
  })
  estado!: EstadoPostulacion;

  /**
   * Por que se rechazo. Obligatorio al rechazar, `null` en cualquier otro
   * estado.
   *
   * Es el unico dato que el candidato recibe cuando no avanza. El diagrama del
   * equipo pide "feedback de por que un candidato no avanzo" y esto es su
   * cimiento: sin un texto escrito por quien decidio, no hay nada que mostrar.
   */
  @Column({ type: 'varchar', length: 500, name: 'motivo_del_rechazo', nullable: true })
  motivoDelRechazo!: string | null;

  /**
   * Quien decidio, y cuando. Mismo criterio que `contratadoEn` en la
   * invitacion: una decision que afecta a una persona tiene que saberse quien
   * la tomo.
   */
  @Column({ type: 'uuid', name: 'id_usuario_que_decidio', nullable: true })
  idUsuarioQueDecidio!: string | null;

  @Column({ type: 'timestamptz', name: 'decidida_en', nullable: true })
  decididaEn!: Date | null;

  /**
   * Si la decidio la maquina y no una persona.
   *
   * Se guarda APARTE de `idUsuarioQueDecidio` y no dejandolo a null: una
   * politica de invitacion automatica la enciende alguien, y esa persona
   * responde por lo que la maquina acepte. Asi no se pierde el responsable.
   */
  @Column({ type: 'boolean', name: 'decision_automatica', default: false })
  decisionAutomatica!: boolean;

  /**
   * El % de afinidad con el que se decidio, o `null` si no habia evidencia o si
   * decidio una persona.
   *
   * Es la unica forma de auditar por que la maquina dijo si. Hace falta
   * guardarlo porque el vocabulario de habilidades se puede editar: si manana
   * se unen dos nombres, todas las afinidades cambian --se calculan en vivo, sin
   * copia-- y el numero de esta decision ya no se podria reconstruir. Mismo
   * criterio que `id_version` en una evaluacion.
   */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'afinidad_al_decidir',
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  afinidadAlDecidir!: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;
}
