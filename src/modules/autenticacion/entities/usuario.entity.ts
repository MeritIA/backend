import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { columnaCifrada } from '../../../common/cifrado/index.js';
import { Rol } from '../dominio/rol.js';

/**
 * Usuario de la plataforma.
 *
 * Vive en el esquema `autenticacion`, como todo lo de este modulo. Ningun otro
 * modulo importa esta entidad: para saber de un usuario se pasa por el servicio
 * de aplicacion que el modulo expone en su index.
 *
 * SOBRE EL CIFRADO DEL CORREO
 *
 * El Plan de Seguridad §5.2 exige cifrar la informacion de identificacion
 * personal, y nombra los correos. Pero una columna cifrada con IV aleatorio no
 * se puede buscar por igualdad ni indexar de forma util, y el inicio de sesion
 * necesita justamente eso.
 *
 * Se resuelve con dos columnas:
 *   - `correo`       cifrado con AES-256-GCM. Es lo que se devuelve y se lee.
 *   - `correoHash`   SHA-256 del correo normalizado. Es por donde se busca y
 *                    donde vive la restriccion de unicidad.
 *
 * El hash es deterministico a proposito: sin eso no habria busqueda. A cambio,
 * quien tuviera acceso a la tabla podria comprobar si un correo concreto esta
 * registrado probandolo, pero no podria obtener la lista de correos. Es el
 * compromiso habitual para un campo que a la vez debe cifrarse y buscarse, y
 * queda anotado aqui para que sea una decision visible y no un descuido.
 */
@Entity({ schema: 'autenticacion', name: 'usuarios' })
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Correo cifrado en reposo. No sirve para buscar: para eso esta correoHash. */
  @Column({ type: 'text', transformer: columnaCifrada() })
  correo!: string;

  /** SHA-256 del correo normalizado. Unico: es la identidad real del usuario. */
  @Index('ux_usuarios_correo_hash', { unique: true })
  @Column({ type: 'char', length: 64, name: 'correo_hash' })
  correoHash!: string;

  /** Hash argon2id de la contrasena. Nunca la contrasena. */
  @Column({ type: 'text', name: 'contrasena_hash' })
  contrasenaHash!: string;

  /** Nombre completo: informacion de identificacion personal, cifrada. */
  @Column({ type: 'text', name: 'nombre_completo', transformer: columnaCifrada() })
  nombreCompleto!: string;

  @Column({ type: 'enum', enum: Rol, enumName: 'rol_usuario' })
  rol!: Rol;

  /**
   * Una cuenta desactivada no puede iniciar sesion ni renovar token. Se prefiere
   * desactivar antes que borrar: las entregas y evaluaciones de un candidato
   * deben seguir siendo auditables.
   */
  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  /**
   * Momento desde el que los tokens de este usuario dejan de valer.
   *
   * Al cerrar sesion en todos los dispositivos, o al cambiar la contrasena, se
   * pone la hora actual y cualquier token emitido antes queda invalidado. Sin
   * esto, un token robado sigue sirviendo hasta que expire y no hay forma de
   * cortarlo.
   */
  @Column({ type: 'timestamptz', name: 'tokens_validos_desde', nullable: true })
  tokensValidosDesde!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'creado_en' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'actualizado_en' })
  actualizadoEn!: Date;
}
