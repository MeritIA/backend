import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class EliminarCuentaDto {
  @ApiProperty({ description: 'La contrasena actual: eliminar la cuenta no se deshace.' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  contrasena!: string;
}
