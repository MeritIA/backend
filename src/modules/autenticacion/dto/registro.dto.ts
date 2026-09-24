import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TipoCliente } from '../dominio/tipo-cliente.js';

/**
 * Datos de registro de un candidato.
 *
 * OJO A LO QUE NO ESTA AQUI: no hay campo `rol`. El registro publico solo crea
 * candidatos. Con `forbidNonWhitelisted` activo, enviar `rol: "administrador"`
 * en el cuerpo devuelve 400 en vez de colarse; el DTO es la frontera.
 * Reclutadores y administradores los crea un administrador por otra via.
 */
export class RegistroDto {
  @ApiProperty({ example: 'candidata@ejemplo.com', maxLength: 254 })
  @IsEmail({}, { message: 'correo debe ser una direccion de correo valida' })
  @MaxLength(254, { message: 'correo no puede superar los 254 caracteres' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  correo!: string;

  @ApiProperty({
    example: 'una-frase-larga-y-dificil',
    minLength: 12,
    maxLength: 128,
    description:
      'Minimo 12 caracteres. Se exige longitud antes que simbolos raros: una frase larga resiste mas que "P@ssw0rd!".',
  })
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

  /** Como se entrega el token. Ver dominio/tipo-cliente.ts. */
  @ApiPropertyOptional({ enum: TipoCliente, default: TipoCliente.Web })
  @IsOptional()
  @IsEnum(TipoCliente, { message: 'cliente debe ser "web" o "apk"' })
  cliente?: TipoCliente;
}
