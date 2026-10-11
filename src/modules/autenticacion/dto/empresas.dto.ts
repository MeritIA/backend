import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Rol } from '../dominio/rol.js';

export class CrearEmpresaDto {
  @ApiProperty({ example: 'Acme S.A.S.', minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2, { message: 'nombre es demasiado corto' })
  @MaxLength(160, { message: 'nombre no puede superar los 160 caracteres' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  nombre!: string;
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
