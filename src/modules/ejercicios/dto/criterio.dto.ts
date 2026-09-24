import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CriterioDto {
  @ApiProperty({ example: 'Correccion funcional', maxLength: 120 })
  @IsString()
  @MinLength(3, { message: 'nombre del criterio es demasiado corto' })
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  nombre!: string;

  @ApiProperty({
    example: 'La solucion resuelve todos los casos del enunciado, incluidos los limite.',
    description:
      'Texto que el motor de IA recibe como referencia de que significa cada nota. Una descripcion vaga produce calificaciones poco fiables.',
    maxLength: 1000,
  })
  @IsString()
  @MinLength(15, {
    message:
      'descripcion del criterio es demasiado corta: el motor de IA la usa como referencia de calificacion',
  })
  @MaxLength(1000)
  descripcion!: string;

  @ApiProperty({ example: 40, description: 'Aporte a la nota final. Los pesos deben sumar 100.' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'peso admite como maximo dos decimales' })
  @Min(0.01, { message: 'peso debe ser mayor que cero' })
  @Max(100, { message: 'peso no puede superar 100' })
  peso!: number;

  @ApiProperty({ example: 5, description: 'El criterio se puntua de 0 a este valor.' })
  @IsInt()
  @Min(1, { message: 'escalaMaxima debe ser al menos 1' })
  @Max(100)
  escalaMaxima!: number;
}
