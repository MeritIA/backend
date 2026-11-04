import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CriterioDto } from './criterio.dto.js';

/**
 * Crea el ejercicio y su version 1 en una sola operacion.
 *
 * No se admite crear un ejercicio sin rubrica: un enunciado sin criterios no se
 * puede calificar, y quedaria en el banco pareciendo utilizable.
 */
export class CrearEjercicioDto {
  @ApiProperty({ example: 'Concurrencia: contador seguro entre hilos', maxLength: 160 })
  @IsString()
  @MinLength(5)
  @MaxLength(160)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  titulo!: string;

  @ApiPropertyOptional({ example: 'Java', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  tecnologia?: string;

  @ApiProperty({ maxLength: 20000, description: 'Enunciado que vera el candidato.' })
  @IsString()
  @MinLength(30, { message: 'enunciado es demasiado corto' })
  @MaxLength(20_000)
  enunciado!: string;

  @ApiProperty({
    type: [CriterioDto],
    description: 'Criterios de la rubrica. Sus pesos suman 100.',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'criterios no puede ir vacio' })
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CriterioDto)
  criterios!: CriterioDto[];

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 600,
    description:
      'Minutos que tiene el candidato desde que inicia el ejercicio. Sin valor: sin limite. ' +
      'El reloj es del servidor: pasado el plazo no se aceptan entregas.',
  })
  @IsOptional()
  @IsInt({ message: 'duracionMinutos debe ser un entero' })
  @Min(1, { message: 'duracionMinutos debe ser al menos 1' })
  @Max(600, { message: 'duracionMinutos no puede superar 600' })
  duracionMinutos?: number;
}
