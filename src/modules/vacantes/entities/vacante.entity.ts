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
import { Modalidad } from '../dominio/modalidad.js';
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

  /** Remoto, hibrido o presencial. Nula en las vacantes anteriores a que existiera. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  modalidad!: Modalidad | null;

  /** Etiquetas libres que el reclutador pone para que el candidato filtre. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tecnologias!: string[];

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

  /**
   * Cuando el reclutador ESPERA cerrar el proceso. Lo muestra la tarjeta de A02.
   *
   * ES INFORMATIVO Y NO CIERRA NADA. Llegada la fecha no pasa nada: cerrar
   * sigue siendo un acto explicito del reclutador (`POST /vacantes/{id}/cerrar`),
   * porque el cierre dispara avisos a personas reales y eso no puede pasar por
   * un reloj que nadie miro. Por lo mismo NO se rechaza una fecha pasada: una
   * vacante que se paso de su estimado es un hecho que el panel debe poder
   * mostrar, y un frontend que reenvia el objeto completo al editar el titulo
   * no tiene por que fallar por un estimado viejo.
   *
   * Si alguna vez se quiere cierre automatico, este campo deja de ser un dato y
   * pasa a ser una regla: habra que decidir que hacer con las entregas en vuelo.
   */
  @Column({ type: 'timestamptz', name: 'cierre_estimado', nullable: true })
  cierreEstimado!: Date | null;

  /**
   * Cuantos finalistas piensa evaluar la empresa. Lo pide la pantalla A04.
   *
   * Es un plan, no un limite: el backend NO impide invitar a mas gente ni
   * evaluar a mas. Ponerlo como tope obligaria a rechazar entregas de alguien
   * ya invitado, que es peor que pasarse del numero.
   *
   * SE PUEDE CAMBIAR CON LA VACANTE PUBLICADA, al contrario que
   * `intentosPermitidos`. La diferencia no es capricho: cambiar los intentos a
   * mitad del proceso le da a unos candidatos mas oportunidades que a otros, y
   * cambiar este numero no le quita nada a nadie. Cuando exista el cobro de A04
   * eso cambia —sera lo que la empresa pago— y habra que congelarlo tras el
   * pago; queda anotado como contradiccion §6.1 de la matriz de pantallas.
   */
  @Column({ type: 'int', name: 'finalistas_a_evaluar', nullable: true })
  finalistasAEvaluar!: number | null;

  /**
   * Si esta vacante invita sola a quien se postula y pasa la politica (A04).
   *
   * Nace apagada. Una funcion que decide sobre personas no se enciende por
   * omision, y encenderla exige que el calculo de afinidad este disponible: ver
   * `dominio/calculador-de-afinidad.ts`.
   */
  @Column({ type: 'boolean', name: 'invitacion_automatica', default: false })
  invitacionAutomatica!: boolean;

  /**
   * Minimo de afinidad para entrar sola, 0 a 100.
   *
   * `null` CON la politica activa no es "cero": es modo abierto, acepta a todo
   * el que se postule hasta el cupo. Es la tesis del producto --el reto es el
   * filtro-- y el unico modo sin trampa del principiante, porque no mira el
   * perfil. La distincion esta explicada en `dominio/politica-de-invitacion.ts`.
   */
  @Column({ type: 'int', name: 'umbral_de_afinidad', nullable: true })
  umbralDeAfinidad!: number | null;

  /**
   * Tope de invitaciones AUTOMATICAS. `null` es sin tope.
   *
   * No se reutiliza `finalistasAEvaluar` a proposito: D-12 dice que ese es un
   * plan y no un maximo, y usarlo como tope la contradiria. El reclutador sigue
   * invitando a mano sin limite.
   */
  @Column({ type: 'int', name: 'cupo_de_invitacion_automatica', nullable: true })
  cupoDeInvitacionAutomatica!: number | null;

  @Column({ type: 'timestamptz', name: 'publicada_en', nullable: true })
  publicadaEn!: Date | null;

  @Column({ type: 'timestamptz', name: 'cerrada_en', nullable: true })
  cerradaEn!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizada_en' })
  actualizadaEn!: Date;
}
