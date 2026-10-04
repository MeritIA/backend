import { plainToInstance, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
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

  /** Base logica de Redis (0-15). Las pruebas de integracion usan otra. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(15)
  REDIS_DB?: number;

  /** Cola de evaluacion (paquete 4.1). Todas opcionales, con valores por omision. */
  @IsOptional()
  @IsIn(['true', 'false'])
  COLA_WORKER_HABILITADO?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  COLA_CONCURRENCIA?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  COLA_REINTENTOS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  COLA_BACKOFF_MS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  COLA_TIMEOUT_MS?: number;

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

  /** Almacenamiento de objetos (paquete 3.3). Credenciales como secreto. */
  @IsString()
  @IsNotEmpty()
  S3_ENDPOINT!: string;

  @IsString()
  @IsNotEmpty()
  S3_BUCKET!: string;

  @IsString()
  @IsNotEmpty({ message: 'S3_ACCESS_KEY es obligatoria' })
  S3_ACCESS_KEY!: string;

  @IsString()
  @IsNotEmpty({ message: 'S3_SECRET_KEY es obligatoria' })
  S3_SECRET_KEY!: string;

  /** Par Ed25519 para PASETO v4, en base64 del PEM. Ver `npm run claves:generar`. */
  @IsString()
  @IsNotEmpty({
    message: 'PASETO_PRIVATE_KEY es obligatoria. Generala con: npm run claves:generar',
  })
  PASETO_PRIVATE_KEY!: string;

  @IsString()
  @IsNotEmpty({ message: 'PASETO_PUBLIC_KEY es obligatoria. Generala con: npm run claves:generar' })
  PASETO_PUBLIC_KEY!: string;

  /**
   * Servicio de evaluacion con IA (paquetes 4.4 y 4.5). Solo el modulo de
   * evaluacion habla con el, y siempre desde la cola.
   */
  @IsOptional()
  @IsString()
  AI_SERVICE_URL?: string;

  @IsOptional()
  @IsString()
  AI_SERVICE_API_KEY?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(600_000)
  AI_REQUEST_TIMEOUT_MS?: number;

  /**
   * Canal de alertas de seguridad (paquete 5.5). Sin SMTP_HOST ni
   * ALERTAS_DESTINO, las alertas se registran en el log y se avisa de que no
   * hay canal; el proceso arranca igual.
   */
  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USUARIO?: string;

  @IsOptional()
  @IsString()
  SMTP_CONTRASENA?: string;

  @IsOptional()
  @IsString()
  SMTP_DESDE?: string;

  /** Destinatarios separados por coma. */
  @IsOptional()
  @IsString()
  ALERTAS_DESTINO?: string;
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
