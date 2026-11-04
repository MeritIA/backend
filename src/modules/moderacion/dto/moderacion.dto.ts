import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export const LONGITUD_MINIMA_DE_JUSTIFICACION = 20;

export class DecidirCasoDto {
  @ApiProperty({
    enum: ['confirmar', 'restaurar'],
    description:
      '`confirmar` descalifica la evaluacion (sale del ranking). `restaurar` la deja, o la devuelve si estaba descalificada.',
  })
  @IsIn(['confirmar', 'restaurar'], { message: 'decision debe ser confirmar o restaurar' })
  decision!: 'confirmar' | 'restaurar';

  @ApiProperty({
    minLength: LONGITUD_MINIMA_DE_JUSTIFICACION,
    maxLength: 1000,
    description: 'Obligatoria: el candidato la lee cuando se confirma su descalificacion.',
  })
  @IsString()
  @Length(LONGITUD_MINIMA_DE_JUSTIFICACION, 1000, {
    message: `justificacion debe tener entre ${LONGITUD_MINIMA_DE_JUSTIFICACION} y 1000 caracteres`,
  })
  justificacion!: string;
}

export class DisputarCasoDto {
  @ApiProperty({ minLength: LONGITUD_MINIMA_DE_JUSTIFICACION, maxLength: 1000 })
  @IsString()
  @Length(LONGITUD_MINIMA_DE_JUSTIFICACION, 1000, {
    message: `explicacion debe tener entre ${LONGITUD_MINIMA_DE_JUSTIFICACION} y 1000 caracteres`,
  })
  explicacion!: string;
}

export class CrearModeradorDto {
  @ApiProperty({ example: 'moderadora@meritia.co', maxLength: 254 })
  @IsEmail({}, { message: 'correo debe ser una direccion de correo valida' })
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  correo!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12, { message: 'contrasena debe tener al menos 12 caracteres' })
  @MaxLength(128)
  contrasena!: string;

  @ApiProperty({ example: 'Marta Lucia Gomez', maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/^[\p{L}\p{M}' .-]+$/u, {
    message: 'nombreCompleto solo admite letras y signos simples',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  nombreCompleto!: string;
}
