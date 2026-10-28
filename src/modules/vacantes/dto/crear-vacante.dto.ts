import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsInt,
  Max,
  Min,
  IsISO8601,
} from 'class-validator';

/**
 * OJO A LO QUE NO ESTA AQUI: ni `estado`, ni `idReclutador`, ni `publicadaEn`.
 *
 * El estado lo gobiernan las operaciones de publicar y cerrar, y el reclutador
 * sale del token. Si estuvieran en el DTO, cualquiera podria crear una vacante
 * ya publicada a nombre de otro. Con `forbidNonWhitelisted` activo, enviarlos
 * devuelve 400.
 */
export class CrearVacanteDto {
  @ApiProperty({ example: 'Desarrollador backend junior', maxLength: 160 })
  @IsString()
  @MinLength(5, { message: 'titulo es demasiado corto' })
  @MaxLength(160, { message: 'titulo no puede superar los 160 caracteres' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  titulo!: string;

  @ApiProperty({
    example: 'Buscamos una persona para el equipo de plataforma...',
    maxLength: 10000,
  })
  @IsString()
  @MinLength(20, { message: 'descripcion es demasiado corta' })
  @MaxLength(10_000, { message: 'descripcion no puede superar los 10000 caracteres' })
  descripcion!: string;

  @ApiPropertyOptional({ example: 'Bogota (hibrido)', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  ubicacion?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10,
    default: 1,
    description:
      'Intentos por candidato y ejercicio. Solo se cambia mientras la vacante es un borrador.',
  })
  @IsOptional()
  @IsInt({ message: 'intentosPermitidos debe ser un entero' })
  @Min(1, { message: 'intentosPermitidos debe ser al menos 1' })
  @Max(10, { message: 'intentosPermitidos no puede superar 10' })
  intentosPermitidos?: number;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-12-15T23:59:59.000Z',
    description:
      'Cuando se espera cerrar el proceso. Es informativo: llegada la fecha el backend no cierra nada, ' +
      'porque cerrar avisa por correo a personas y no puede dispararlo un reloj. Se aceptan fechas pasadas.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'cierreEstimado debe ser una fecha ISO 8601' })
  cierreEstimado?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1000,
    description:
      'Cuantos finalistas se piensa evaluar. Es un plan, no un tope: no impide invitar ni evaluar a mas.',
  })
  @IsOptional()
  @IsInt({ message: 'finalistasAEvaluar debe ser un entero' })
  @Min(1, { message: 'finalistasAEvaluar debe ser al menos 1' })
  // La cota alta no es una regla de negocio: evita que un error de captura
  // guarde un numero absurdo que luego el panel muestre como si fuera un plan.
  @Max(1000, { message: 'finalistasAEvaluar no puede superar 1000' })
  finalistasAEvaluar?: number;
}
