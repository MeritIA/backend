import { plainToInstance, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum Entorno {
  Desarrollo = 'development',
  Pruebas = 'test',
  Produccion = 'production',
}

/**
 * Contrato de las variables de entorno que el backend necesita para arrancar.
 *
 * Se valida una sola vez al iniciar y, si algo falta o viene mal, el proceso
 * no levanta. Es preferible un fallo ruidoso en el arranque a descubrir a mitad
 * de una peticion que la contrasena de la base de datos venia vacia.
 *
 * Aqui solo estan las variables que hoy se usan de verdad. Las de PASETO,
 * cifrado, CORS, limites de peticiones y servicio de IA se anaden en el
 * paquete que las introduce, para no bloquear el arranque por claves que
 * todavia no lee nadie.
 */
export class VariablesDeEntorno {
  @IsEnum(Entorno)
  NODE_ENV!: Entorno;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DATABASE_PORT!: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_USER!: string;

  @IsString()
  @IsNotEmpty({ message: 'DATABASE_PASSWORD no puede ir vacia' })
  DATABASE_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_NAME!: string;

  @Type(() => Boolean)
  @IsBoolean()
  DATABASE_SSL!: boolean;
}

export function validarEntorno(configuracion: Record<string, unknown>): VariablesDeEntorno {
  const validada = plainToInstance(VariablesDeEntorno, configuracion, {
    enableImplicitConversion: true,
  });

  const errores = validateSync(validada, { skipMissingProperties: false });

  if (errores.length > 0) {
    const detalle = errores
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(
      `Configuracion de entorno invalida. Revisa tu .env (hay una plantilla en .env.example):\n${detalle}`,
    );
  }

  return validada;
}
