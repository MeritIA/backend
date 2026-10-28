import { ApiPropertyOptional } from '@nestjs/swagger';
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

/** Todo opcional: se edita solo lo que se envia. */
export class EditarVacanteDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  titulo?: string;

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(10_000)
  descripcion?: string;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  ubicacion?: string | null;

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
    nullable: true,
    description: 'Null borra el estimado. Se aceptan fechas pasadas: ver la entidad.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'cierreEstimado debe ser una fecha ISO 8601' })
  cierreEstimado?: string | null;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1000,
    nullable: true,
    description:
      'Se puede cambiar con la vacante ya publicada, al contrario que intentosPermitidos: ' +
      'subirlo o bajarlo no le quita oportunidades a ningun candidato. Null borra el plan.',
  })
  @IsOptional()
  @IsInt({ message: 'finalistasAEvaluar debe ser un entero' })
  @Min(1, { message: 'finalistasAEvaluar debe ser al menos 1' })
  @Max(1000, { message: 'finalistasAEvaluar no puede superar 1000' })
  finalistasAEvaluar?: number | null;
}
