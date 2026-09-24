import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, IsInt, Max, Min } from 'class-validator';

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
}
