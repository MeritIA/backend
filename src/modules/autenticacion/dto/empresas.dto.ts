import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Rol } from '../dominio/rol.js';
import { TipoCliente } from '../dominio/tipo-cliente.js';
import { normalizarNit } from '../dominio/nit.js';
import { SECTORES, SectorEmpresa } from '../dominio/sector.js';

export class CrearEmpresaDto {
  @ApiProperty({ example: 'Acme S.A.S.', minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2, { message: 'nombre es demasiado corto' })
  @MaxLength(160, { message: 'nombre no puede superar los 160 caracteres' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  nombre!: string;

  /**
   * Obligatorio en la API, aunque la columna tenga valor por omision.
   *
   * El valor por omision existe para las filas anteriores a la columna, no para
   * que alguien cree una empresa sin clasificarla: el sector es lo que permite
   * responder "cuantas convocatorias al ano tiene el sector financiero".
   */
  @ApiProperty({
    enum: SECTORES,
    example: SectorEmpresa.Financiero,
    description:
      'Sector economico, de una lista cerrada para que los informes se puedan agrupar. La lista no esta ratificada: ver docs/declaracion-de-alcance.md.',
  })
  @IsEnum(SectorEmpresa, { message: `sector debe ser uno de: ${SECTORES.join(', ')}` })
  sector!: SectorEmpresa;

  /**
   * Opcional, y se guarda normalizado.
   *
   * Si llega, se exige el digito de verificacion y se comprueba: mientras no
   * exista la verificacion contra la Camara de Comercio, ese digito es la unica
   * comprobacion disponible. La aritmetica esta en `dominio/nit.ts`; aqui solo
   * se mira la forma, para que el 400 diga que es de forma y no de calculo.
   */
  @ApiPropertyOptional({
    example: '890903938-8',
    description:
      'NIT con digito de verificacion. Los puntos y los espacios se quitan. Unico entre empresas.',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarNit(value.trim()) : value,
  )
  @Matches(/^\d{8,15}-\d$/, {
    message: 'nit debe tener entre 8 y 15 digitos, un guion y el digito de verificacion',
  })
  nit?: string;
}

/**
 * Alta de un usuario dentro de una empresa.
 *
 * Es la otra via que menciona el registro publico: alli solo se crean
 * candidatos, y reclutadores y administradores los crea un administrador por
 * aqui. Las reglas de correo, contrasena y nombre son las mismas del registro:
 * relajarlas en este camino dejaria una puerta mas debil a la misma casa.
 */
export class CrearUsuarioDeEmpresaDto {
  @ApiProperty({ example: 'reclutador@acme.com', maxLength: 254 })
  @IsEmail({}, { message: 'correo debe ser una direccion de correo valida' })
  @MaxLength(254, { message: 'correo no puede superar los 254 caracteres' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  correo!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12, { message: 'contrasena debe tener al menos 12 caracteres' })
  @MaxLength(128, { message: 'contrasena no puede superar los 128 caracteres' })
  contrasena!: string;

  @ApiProperty({ example: 'Ana Maria Torres', maxLength: 120 })
  @IsString()
  @MinLength(2, { message: 'nombreCompleto es demasiado corto' })
  @MaxLength(120, { message: 'nombreCompleto no puede superar los 120 caracteres' })
  @Matches(/^[\p{L}\p{M}' .-]+$/u, {
    message: 'nombreCompleto solo admite letras, espacios, apostrofos, puntos y guiones',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  nombreCompleto!: string;

  @ApiProperty({
    enum: [Rol.Reclutador, Rol.Administrador],
    description:
      'Solo reclutador o administrador. Los candidatos se crean solos por el registro publico: no pertenecen a ninguna empresa.',
  })
  @IsIn([Rol.Reclutador, Rol.Administrador], {
    message: 'rol debe ser "reclutador" o "administrador"',
  })
  rol!: Rol.Reclutador | Rol.Administrador;
}

export class EmpresaRespuesta {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty({ enum: SECTORES }) sector!: SectorEmpresa;
  @ApiProperty({ nullable: true, example: '890903938-8' }) nit!: string | null;
  @ApiProperty() activa!: boolean;
  @ApiProperty() creadaEn!: Date;
}

export class UsuarioDeEmpresaRespuesta {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() correo!: string;
  @ApiProperty() nombreCompleto!: string;
  @ApiProperty({ enum: Rol }) rol!: Rol;
  @ApiProperty({ format: 'uuid' }) idEmpresa!: string;
}

/**
 * Auto-registro de una empresa (pantalla A01).
 *
 * Crea la empresa y a su primer administrador en un solo acto. A diferencia de
 * `CrearEmpresaDto`, el NIT es obligatorio: sin un administrador de plataforma
 * mirando, el digito de verificacion es la unica comprobacion disponible, y la
 * verificacion contra la Camara de Comercio sigue sin existir.
 */
export class RegistrarEmpresaDto {
  @ApiProperty({ example: 'Acme S.A.S.', minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2, { message: 'nombreEmpresa es demasiado corto' })
  @MaxLength(160, { message: 'nombreEmpresa no puede superar los 160 caracteres' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  nombreEmpresa!: string;

  @ApiProperty({ enum: SECTORES, example: SectorEmpresa.Financiero })
  @IsEnum(SectorEmpresa, { message: `sector debe ser uno de: ${SECTORES.join(', ')}` })
  sector!: SectorEmpresa;

  @ApiProperty({ example: '890903938-8', description: 'NIT con digito de verificacion. Unico.' })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarNit(value.trim()) : value,
  )
  @Matches(/^\d{8,15}-\d$/, {
    message: 'nit debe tener entre 8 y 15 digitos, un guion y el digito de verificacion',
  })
  nit!: string;

  @ApiProperty({ example: 'ana@acme.com', maxLength: 254 })
  @IsEmail({}, { message: 'correo debe ser una direccion de correo valida' })
  @MaxLength(254, { message: 'correo no puede superar los 254 caracteres' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  correo!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12, { message: 'contrasena debe tener al menos 12 caracteres' })
  @MaxLength(128, { message: 'contrasena no puede superar los 128 caracteres' })
  contrasena!: string;

  @ApiProperty({ example: 'Ana Maria Torres', maxLength: 120 })
  @IsString()
  @MinLength(2, { message: 'nombreCompleto es demasiado corto' })
  @MaxLength(120, { message: 'nombreCompleto no puede superar los 120 caracteres' })
  @Matches(/^[\p{L}\p{M}' .-]+$/u, {
    message: 'nombreCompleto solo admite letras, espacios, apostrofos, puntos y guiones',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  nombreCompleto!: string;

  @ApiPropertyOptional({ enum: TipoCliente, default: TipoCliente.Web })
  @IsOptional()
  @IsEnum(TipoCliente, { message: 'cliente debe ser "web" o "apk"' })
  cliente?: TipoCliente;
}
