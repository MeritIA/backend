import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Cifrado simetrico de datos sensibles en reposo.
 *
 * Plan de Seguridad §5.2: AES-256-GCM, formato de almacenamiento
 * `iv:authTag:ciphertext` con las tres partes en base64, y clave tomada de la
 * variable de entorno ENCRYPTION_KEY.
 *
 * Se usa GCM y no CBC porque autentica la integridad: si alguien manipula una
 * fila cifrada en la base de datos, el descifrado falla en vez de devolver
 * basura que la aplicacion tomaria por buena.
 *
 * Solo node:crypto, sin dependencias externas.
 */

const ALGORITMO = 'aes-256-gcm';
const BYTES_IV = 12; // 96 bits, el tamano recomendado para GCM
const BYTES_AUTH_TAG = 16;
const BYTES_CLAVE = 32; // 256 bits
const SEPARADOR = ':';

export class ClaveDeCifradoInvalidaError extends Error {}
export class DescifradoFallidoError extends Error {}

/**
 * Lee y valida ENCRYPTION_KEY. Se espera una cadena de 64 caracteres
 * hexadecimales, que son los 32 bytes que exige AES-256. Generarla con:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export function leerClaveDeCifrado(valor: string | undefined): Buffer {
  if (!valor) {
    throw new ClaveDeCifradoInvalidaError(
      "ENCRYPTION_KEY no esta definida. Genera una con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(valor)) {
    throw new ClaveDeCifradoInvalidaError(
      `ENCRYPTION_KEY debe ser de 64 caracteres hexadecimales (32 bytes); recibidos ${valor.length} caracteres.`,
    );
  }
  return Buffer.from(valor, 'hex');
}

export class CifradoService {
  private readonly clave: Buffer;

  constructor(claveHex: string | undefined = process.env.ENCRYPTION_KEY) {
    this.clave = leerClaveDeCifrado(claveHex);
    if (this.clave.length !== BYTES_CLAVE) {
      throw new ClaveDeCifradoInvalidaError('La clave de cifrado no mide 32 bytes.');
    }
  }

  /**
   * Devuelve `iv:authTag:ciphertext` en base64.
   *
   * El IV es aleatorio en cada llamada, asi que cifrar dos veces el mismo texto
   * produce resultados distintos. Eso es deliberado: impide deducir que dos
   * filas guardan el mismo valor con solo mirarlas.
   */
  cifrar(textoPlano: string): string {
    const iv = randomBytes(BYTES_IV);
    const cipher = createCipheriv(ALGORITMO, this.clave, iv);
    const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv.toString('base64'), authTag.toString('base64'), cifrado.toString('base64')].join(
      SEPARADOR,
    );
  }

  /**
   * Deshace `cifrar`. Lanza DescifradoFallidoError si el formato no cuadra o si
   * la etiqueta de autenticacion no valida, que es lo que ocurre cuando el dato
   * fue manipulado o se cifro con otra clave.
   */
  descifrar(almacenado: string): string {
    const partes = almacenado.split(SEPARADOR);
    if (partes.length !== 3) {
      throw new DescifradoFallidoError(
        'Formato invalido: se esperaba iv:authTag:ciphertext en base64.',
      );
    }

    const [ivB64, authTagB64, cifradoB64] = partes;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const cifrado = Buffer.from(cifradoB64, 'base64');

    if (iv.length !== BYTES_IV) {
      throw new DescifradoFallidoError(`IV invalido: se esperaban ${BYTES_IV} bytes.`);
    }
    if (authTag.length !== BYTES_AUTH_TAG) {
      throw new DescifradoFallidoError(
        `Etiqueta de autenticacion invalida: se esperaban ${BYTES_AUTH_TAG} bytes.`,
      );
    }

    try {
      const decipher = createDecipheriv(ALGORITMO, this.clave, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
    } catch {
      // No se propaga el error original a proposito: su detalle no aporta a
      // quien llama y podria acabar en un log o en una respuesta HTTP.
      throw new DescifradoFallidoError(
        'No se pudo descifrar: el dato fue manipulado o se cifro con otra clave.',
      );
    }
  }

  /** Comparacion en tiempo constante, para no filtrar informacion por el tiempo de respuesta. */
  static sonIguales(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
