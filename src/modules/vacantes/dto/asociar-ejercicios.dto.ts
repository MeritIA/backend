import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class AsociarEjerciciosDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Identificadores de los ejercicios, en el orden en que los vera el candidato. Reemplaza la lista anterior.',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'idsDeEjercicios no puede ir vacio' })
  @ArrayMaxSize(20, { message: 'idsDeEjercicios admite como maximo 20 ejercicios' })
  @IsUUID('4', { each: true, message: 'idsDeEjercicios debe contener identificadores validos' })
  idsDeEjercicios!: string[];
}
