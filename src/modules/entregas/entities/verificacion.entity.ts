import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ModalidadDeVerificacion = 'camara' | 'alterna';

/** Dias que se conserva la foto: lo que el candidato leyo al dar su consentimiento. */
export const DIAS_DE_CONSERVACION = 90;

@Entity({ schema: 'entregas', name: 'verificaciones' })
export class Verificacion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_entrega', unique: true })
  idEntrega!: string;

  @Column({ type: 'varchar', length: 10 })
  modalidad!: ModalidadDeVerificacion;

  /** Nula en la modalidad alterna y despues de purgar. */
  @Column({ type: 'text', nullable: true })
  clave!: string | null;

  @Column({ type: 'varchar', length: 20, name: 'tipo_contenido', nullable: true })
  tipoContenido!: string | null;

  @Column({ type: 'int', nullable: true })
  bytes!: number | null;

  @Column({ type: 'char', length: 64, nullable: true })
  sha256!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creada_en' })
  creadaEn!: Date;

  @Column({ type: 'timestamptz', name: 'conservar_hasta', nullable: true })
  conservarHasta!: Date | null;

  @Column({ type: 'timestamptz', name: 'purgada_en', nullable: true })
  purgadaEn!: Date | null;
}
