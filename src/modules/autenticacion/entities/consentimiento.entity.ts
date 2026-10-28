import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { OrigenDelConsentimiento, TipoDeConsentimiento } from '../dominio/consentimiento.js';

/**
 * Una decision del titular sobre uno de sus permisos.
 *
 * ESTA TABLA SOLO CRECE: NO SE ACTUALIZA NI SE BORRA
 *
 * Es la diferencia entre un registro de consentimientos y una casilla. Con un
 * booleano por usuario se sabe lo que autoriza hoy; con filas se puede
 * responder "desde cuando lo autorizaba" y "que habia autorizado en marzo",
 * que es lo que la Ley 1581 obliga a poder demostrar y lo que una reclamacion
 * pregunta. Revocar es insertar una fila con `concedido = false`, nunca borrar
 * la de antes: borrar el rastro de un consentimiento es perder justamente la
 * prueba de que existio.
 *
 * Por eso no hay unico sobre (usuario, tipo) —habria uno por decision— y el
 * estado actual es la fila mas reciente de cada par.
 *
 * NO GUARDA IP NI NAVEGADOR
 *
 * Se penso y se deja fuera. Una IP es un dato personal mas, y recogerla "por
 * si acaso" dentro del registro que existe para no recoger de mas seria
 * contradecirse. Quien, que, cuando y desde que pantalla alcanza para probar
 * el consentimiento; la trazabilidad tecnica ya vive en los logs.
 */
@Entity({ schema: 'autenticacion', name: 'consentimientos' })
// El estado actual es "la ultima fila de este usuario y este tipo", asi que la
// consulta siempre lleva las tres columnas en este orden.
@Index('ix_consentimientos_usuario_tipo', ['idUsuario', 'tipo', 'registradoEn'])
export class Consentimiento {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'id_usuario' })
  idUsuario!: string;

  @Column({ type: 'enum', enum: TipoDeConsentimiento, enumName: 'tipo_de_consentimiento' })
  tipo!: TipoDeConsentimiento;

  /** `true` lo concede, `false` lo revoca. Las dos cosas son una decision. */
  @Column({ type: 'boolean' })
  concedido!: boolean;

  /**
   * Que version del texto leyo. Sin esto, un "si" de hace un año no dice a que
   * dijo que si, porque la descripcion del permiso pudo cambiar desde entonces.
   */
  @Column({ type: 'varchar', length: 20, name: 'version_del_aviso' })
  versionDelAviso!: string;

  /** Desde donde: el registro (B12) o el panel de privacidad (B24). */
  @Column({ type: 'enum', enum: OrigenDelConsentimiento, enumName: 'origen_de_consentimiento' })
  origen!: OrigenDelConsentimiento;

  @CreateDateColumn({ type: 'timestamptz', name: 'registrado_en' })
  registradoEn!: Date;
}
