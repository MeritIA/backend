import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CriterioDto } from './criterio.dto.js';

/**
 * Crea la version siguiente. El enunciado y la rubrica van completos, no por
 * partes: una version es una unidad cerrada, y aceptar cambios parciales
 * llevaria a versiones que heredan criterios sin que nadie los haya revisado.
 */
export class NuevaVersionDto {
  @ApiProperty({ maxLength: 20000 })
  @IsString()
  @MinLength(30)
  @MaxLength(20_000)
  enunciado!: string;

  @ApiProperty({ type: [CriterioDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CriterioDto)
  criterios!: CriterioDto[];

  @ApiPropertyOptional({
    example: 'Se aclara el caso limite de la lista vacia, que confundia a los candidatos.',
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivoDelCambio?: string;
}
