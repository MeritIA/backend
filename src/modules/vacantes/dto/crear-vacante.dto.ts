import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
