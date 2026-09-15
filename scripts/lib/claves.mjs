import { createPublicKey, randomBytes } from 'node:crypto';
import pkg from 'paseto';

const { V4 } = pkg;

/**
 * Genera el par Ed25519 de PASETO v4 y la clave AES-256 de cifrado en reposo.
 *
 * Compartido por `npm run claves:generar` (quien configura un entorno) y por
 * la CI, que crea claves efimeras en cada ejecucion: asi las dos usan
 * exactamente el mismo formato y no hay un segundo generador que se desvie.
 */
export async function generarClaves() {
  const secreta = await V4.generateKey('public');
  return {
    PASETO_PRIVATE_KEY: Buffer.from(secreta.export({ type: 'pkcs8', format: 'pem' })).toString(
      'base64',
    ),
    PASETO_PUBLIC_KEY: Buffer.from(
      createPublicKey(secreta).export({ type: 'spki', format: 'pem' }),
    ).toString('base64'),
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
}
