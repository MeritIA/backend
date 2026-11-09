import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';

export class CrearHabilidadDto {
  @ApiProperty({
    maxLength: 120,
    description:
      'El nombre canonico, tal como se mostrara. Se compara normalizado, asi que las mayusculas y los acentos son solo presentacion.',
    example: 'Claridad del codigo',
  })
  @IsString({ message: 'nombre debe ser texto' })
  @Length(3, 120, { message: 'nombre debe tener entre 3 y 120 caracteres' })
  nombre!: string;

  @ApiProperty({
    description:
      'Que se entiende por esta habilidad. Es lo que evita que dos reclutadores la usen para cosas distintas.',
    example:
      'Nombres descriptivos, estructura simple y comentarios donde aportan. No incluye correccion funcional.',
  })
  @IsString({ message: 'descripcion debe ser texto' })
  @Length(20, 1000, {
    message: 'descripcion debe tener entre 20 y 1000 caracteres: es lo que desambigua la habilidad',
  })
  descripcion!: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description:
      'Otras formas de escribirla. Un termino no puede ser alias de dos habilidades, ni el nombre canonico de otra.',
    example: ['Legibilidad', 'Codigo legible'],
  })
  @IsOptional()
  @IsArray({ message: 'alias debe ser una lista' })
  @ArrayMaxSize(50, { message: 'alias admite como maximo 50 terminos' })
  @IsString({ each: true, message: 'cada alias debe ser texto' })
  @Length(2, 120, { each: true, message: 'cada alias debe tener entre 2 y 120 caracteres' })
  alias?: string[];
}

export class AnadirAliasDto {
  @ApiProperty({
    maxLength: 120,
    description: 'Otra forma de escribir el nombre de esta habilidad.',
    example: 'Legibilidad',
  })
  @IsString({ message: 'termino debe ser texto' })
  @Length(2, 120, { message: 'termino debe tener entre 2 y 120 caracteres' })
  termino!: string;
}
