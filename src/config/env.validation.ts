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

  /** Ver `migracionesAutomaticas()`. Omitida: encendida salvo en pruebas. */
  @IsOptional()
  @IsIn(['true', 'false'])
  MIGRACIONES_AUTOMATICAS?: string;

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

  /**
   * Direccion del almacenamiento tal como la ve el NAVEGADOR, solo para firmar
   * enlaces de descarga. Dentro de compose el backend habla con
   * `http://almacenamiento:8333`, que el navegador no resuelve. Sin valor se usa
   * S3_ENDPOINT.
   */
  @IsOptional()
  @IsString()
  S3_PUBLIC_ENDPOINT?: string;

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

  /**
   * Servicio del mentor (rag-service). Opcional: si falta, el mentor usa
   * AI_SERVICE_URL y AI_SERVICE_API_KEY, como antes.
   */
  @IsOptional()
  @IsString()
  MENTOR_SERVICE_URL?: string;

  @IsOptional()
  @IsString()
  MENTOR_SERVICE_API_KEY?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(600_000)
  AI_REQUEST_TIMEOUT_MS?: number;

  /**
   * Tope de peticiones en vuelo antes de rechazar con 503 (P1 de
   * docs/rendimiento.md).
   *
   * El valor por omision (50) sale de la medicion y no del gusto: por la ley de
   * Little, 100 pet/s medidos x 0,5 s de objetivo de p95 = 50 en vuelo. DEPENDE
   * DE LA MAQUINA: al cambiarla hay que repetir el barrido de carga y
   * recalcularlo.
   *
   * Se admite 0, que rechaza todo. No es util en produccion pero hace
   * determinista la prueba de integracion: sin eso habria que provocar una
   * carrera entre peticiones concurrentes para ver un rechazo, y una prueba de
   * seguridad que depende del azar es peor que no tenerla.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  ADMISION_MAXIMO_EN_VUELO?: number;

  /**
   * Saltos de proxy de confianza delante de la aplicacion (nginx, ingress...).
   * Sin esto `req.ip` es la IP del proxy y el limitador por IP cuenta a todos
   * los usuarios como uno solo. Omitida: no se confia en ningun proxy.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY?: number;

  /** Preguntas al mentor esperando al modelo a la vez. Omitida: 10. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  MENTOR_MAXIMO_EN_VUELO?: number;

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

  /**
   * Manda TODO el correo a candidatos a una sola direccion, con el destinatario
   * real escrito en el cuerpo.
   *
   * Existe para que un entorno de preproduccion con SMTP de verdad no le
   * escriba a personas reales con datos sembrados. Las alertas de seguridad no
   * se redirigen: ya van al equipo.
   */
  @IsOptional()
  @IsString()
  CORREO_REDIRECCION?: string;

  /**
   * Avisar por correo a los candidatos cuando se cierra una vacante.
   *
   * Apagado si no se pone en 'true', y no por timidez: SMTP existe hoy para
   * mandar alertas de seguridad al equipo, asi que sin interruptor el dia que
   * alguien lo configure para eso empezaria a escribirle a candidatos reales
   * de rebote. Con el canal apagado los avisos se registran igual en estado
   * pendiente, y el reenvio los recoge cuando se encienda.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  NOTIFICACIONES_A_CANDIDATOS?: string;

  /**
   * Donde entra el candidato a ver su resultado. Si falta, el correo no la
   * inventa: dice que el resultado esta en la plataforma y no pone enlace.
   */
  @IsOptional()
  @IsString()
  URL_PLATAFORMA?: string;
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
