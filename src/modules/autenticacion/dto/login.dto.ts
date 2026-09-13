import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { TipoCliente } from '../dominio/tipo-cliente.js';

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

  /**
   * Como se entrega el token. Ver dominio/tipo-cliente.ts.
   *
   * Por omision `web`, que es la opcion segura: si un cliente no lo declara,
   * recibe la cookie HttpOnly y ningun token en el cuerpo. Equivocarse hacia el
   * lado contrario significaria entregarle el token en el JSON a un navegador.
   */
  @ApiPropertyOptional({
    enum: TipoCliente,
    default: TipoCliente.Web,
    description:
      'web: el token viaja en cookie HttpOnly y NO en el cuerpo. apk: viaja en el cuerpo, para guardarlo en el KeyStore.',
  })
  @IsOptional()
  @IsEnum(TipoCliente, { message: 'cliente debe ser "web" o "apk"' })
  cliente?: TipoCliente;
}
