import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TipoCliente } from '../dominio/tipo-cliente.js';

export class RenovarDto {
  @ApiPropertyOptional({
    description:
      'Token de renovacion. Solo lo envia la APK: en la web viaja en la cookie HttpOnly y no hace falta mandarlo.',
    example: 'v4.public.eyJzdWIiOiIuLi4ifQ...',
  })
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(2048)
  tokenDeRenovacion?: string;

  /** Como se entrega el token nuevo. Ver dominio/tipo-cliente.ts. */
  @ApiPropertyOptional({ enum: TipoCliente, default: TipoCliente.Web })
  @IsOptional()
  @IsEnum(TipoCliente, { message: 'cliente debe ser "web" o "apk"' })
  cliente?: TipoCliente;
}
