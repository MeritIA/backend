/**
 * Genera el par Ed25519 para PASETO v4 y la clave de cifrado AES-256.
 *
 *   npm run claves:generar
 *
 * Imprime las tres lineas para pegar en .env. No escribe el fichero a
 * proposito: que las claves pasen por los ojos de quien las genera evita
 * sobrescribir sin querer las de un entorno que ya estaba funcionando.
 */
import { generarClaves } from './lib/claves.mjs';

const claves = await generarClaves();

console.log('\nPega estas lineas en tu .env (y NUNCA las subas a Git):\n');
for (const [nombre, valor] of Object.entries(claves)) console.log(`${nombre}=${valor}`);
console.log(
  '\nRotacion: anual o ante sospecha de compromiso (Plan de Seguridad §8).\n' +
    'Al rotar ENCRYPTION_KEY hay que re-cifrar los datos ya guardados.\n',
);
