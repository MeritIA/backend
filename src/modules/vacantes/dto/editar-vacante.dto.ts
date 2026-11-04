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
  IsEnum,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import {
  Modalidad,
  MAXIMO_DE_TECNOLOGIAS,
  LONGITUD_MAXIMA_DE_TECNOLOGIA,
} from '../dominio/modalidad.js';

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
    enum: Modalidad,
    nullable: true,
    description: 'Remoto, hibrido o presencial.',
  })
  @IsOptional()
  @IsEnum(Modalidad, { message: 'modalidad debe ser remoto, hibrido o presencial' })
  modalidad?: Modalidad | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAXIMO_DE_TECNOLOGIAS,
    description: 'Tecnologias de la vacante. En la edicion reemplaza la lista completa.',
  })
  @IsOptional()
  @IsArray({ message: 'tecnologias debe ser una lista' })
  @ArrayMaxSize(MAXIMO_DE_TECNOLOGIAS, {
    message: `tecnologias admite hasta ${MAXIMO_DE_TECNOLOGIAS}`,
  })
  @IsString({ each: true, message: 'cada tecnologia debe ser texto' })
  @MinLength(1, { each: true, message: 'una tecnologia no puede estar vacia' })
  @MaxLength(LONGITUD_MAXIMA_DE_TECNOLOGIA, {
    each: true,
    message: `cada tecnologia admite hasta ${LONGITUD_MAXIMA_DE_TECNOLOGIA} caracteres`,
  })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? (value as unknown[]).map((t) => (typeof t === 'string' ? t.trim() : t))
      : value,
  )
  tecnologias?: string[];

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
