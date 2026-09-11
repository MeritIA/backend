/**
 * Genera el par Ed25519 para PASETO v4 y la clave de cifrado AES-256.
 *
 *   npm run claves:generar
 *
 * Imprime las tres lineas para pegar en .env. No escribe el fichero a
 * proposito: que las claves pasen por los ojos de quien las genera evita
 * sobrescribir sin querer las de un entorno que ya estaba funcionando.
 */
import { createPublicKey, randomBytes } from 'node:crypto';
import pkg from 'paseto';

const { V4 } = pkg;
const secreta = await V4.generateKey('public');
const privada = Buffer.from(secreta.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
const publica = Buffer.from(
  createPublicKey(secreta).export({ type: 'spki', format: 'pem' }),
).toString('base64');

console.log('\nPega estas lineas en tu .env (y NUNCA las subas a Git):\n');
console.log(`PASETO_PRIVATE_KEY=${privada}`);
console.log(`PASETO_PUBLIC_KEY=${publica}`);
console.log(`ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
console.log(
  '\nRotacion: anual o ante sospecha de compromiso (Plan de Seguridad §8).\n' +
    'Al rotar ENCRYPTION_KEY hay que re-cifrar los datos ya guardados.\n',
);
