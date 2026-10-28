import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EstadoDeAviso, TipoDeAviso } from '../dominio/estado-aviso.js';

/**
 * Un aviso por correo a un candidato.
 *
 * POR QUE SE GUARDA LO QUE SE ENVIA
 *
 * Tres razones, y ninguna es el gusto por las tablas:
 *
 * 1. NO REPETIR. El unico (vacante, candidato, tipo) es lo que impide que un
 *    cierre publicado dos veces, o un reenvio manual, le escriba dos veces a la
 *    misma persona. La garantia es de la base de datos, no del codigo.
 * 2. NO PERDER A NADIE. El bus de eventos es en memoria: si el proceso se cae
 *    entre el cierre y el envio, el evento se pierde. La fila queda en
 *    `pendiente` y el reenvio la recoge. Sin tabla, ese candidato no se enteraba
 *    nunca y nadie lo sabria.
 * 3. PODER RESPONDER "QUE LE DIJIMOS". Un proceso de seleccion acaba en
 *    reclamos, y la Ley 1581 da al titular derecho a saber que se hizo con sus
 *    datos. Esto responde a quien, cuando y de que, sin guardar el cuerpo.
 *
 * QUE NO SE GUARDA
 *
 * La direccion de correo. Esta cifrada en el modulo de autenticacion y
 * copiarla aqui la repartiria por el monolito sin necesidad: al momento de
 * enviar se pide por la puerta de ese modulo y se usa. Tampoco el cuerpo del
 * mensaje: se reconstruye con la plantilla y el titulo de la vacante.
 */
@Entity({ schema: 'notificaciones', name: 'avisos' })
@Index('ux_avisos_vacante_candidato_tipo', ['idVacante', 'idCandidato', 'tipo'], { unique: true })
export class Aviso {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_avisos_vacante')
  @Column({ type: 'uuid', name: 'id_vacante' })
  idVacante!: string;

  @Column({ type: 'uuid', name: 'id_candidato' })
  idCandidato!: string;

  @Column({ type: 'enum', enum: TipoDeAviso, enumName: 'tipo_de_aviso' })
  tipo!: TipoDeAviso;

  @Column({
    type: 'enum',
    enum: EstadoDeAviso,
    enumName: 'estado_de_aviso',
    default: EstadoDeAviso.Pendiente,
  })
  estado!: EstadoDeAviso;

  /** Cuantas veces se intento. Un numero alto aqui es un problema de canal, no de codigo. */
  @Column({ type: 'int', default: 0 })
  intentos!: number;

  /** Cuando se entrego al servidor de salida. Null mientras no se haya logrado. */
  @Column({ type: 'timestamptz', name: 'enviado_en', nullable: true })
  enviadoEn!: Date | null;

  /**
   * El motivo del ultimo fallo, para que el reclutador pueda ver por que no
   * salio sin leer los logs del servidor.
   */
  @Column({ type: 'text', name: 'ultimo_error', nullable: true })
  ultimoError!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  creadoEn!: Date;

  /** Se mira para recuperar filas que quedaron reservadas por un proceso que murio. */
  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizado_en' })
  actualizadoEn!: Date;
}
