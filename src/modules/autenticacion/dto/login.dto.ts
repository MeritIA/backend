import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'candidata@ejemplo.com' })
  @IsEmail({}, { message: 'correo debe ser una direccion de correo valida' })
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  correo!: string;

  @ApiProperty({ example: 'una-frase-larga-y-dificil' })
  @IsString()
  @MaxLength(128)
  contrasena!: string;
}
