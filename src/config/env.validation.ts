import { plainToInstance, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
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

  @IsString()
  @IsNotEmpty()
  REDIS_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT!: number;

  /**
   * Clave AES-256 en hexadecimal (Plan de Seguridad §5.2). Generarla con:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message:
      "ENCRYPTION_KEY debe ser de 64 caracteres hexadecimales (32 bytes). Generala con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  })
  ENCRYPTION_KEY!: string;

  /**
   * Origenes permitidos por CORS, separados por coma. Obligatorio en
   * produccion: sin el, se rechazan todas las peticiones cruzadas.
   */
  @ValidateIf((v: VariablesDeEntorno) => v.NODE_ENV === Entorno.Produccion)
  @IsString()
  @IsNotEmpty({ message: 'ALLOWED_ORIGINS es obligatoria en produccion' })
  ALLOWED_ORIGINS?: string;
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
