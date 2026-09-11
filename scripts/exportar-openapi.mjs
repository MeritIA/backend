/**
 * Exporta la especificacion OpenAPI a docs/openapi.json.
 *
 * El riesgo que señala la ficha del paquete 5.2 es que la documentacion se
 * desactualice frente al codigo. Versionar el fichero generado permite dos
 * cosas: que un cambio en la API se vea en el diff de la revision por pares, y
 * que el pipeline falle si alguien toca un endpoint y no regenera la
 * especificacion.
 *
 *   npm run openapi:export     genera docs/openapi.json
 *   npm run openapi:check      falla si el fichero no corresponde al codigo
 *
 * Se levanta la aplicacion en modo `preview`: Nest construye el grafo de
 * modulos y controladores pero NO instancia los proveedores, asi que no abre
 * conexion a PostgreSQL ni a Redis. Eso permite generar la especificacion en
 * integracion continua sin infraestructura detras.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const destino = path.join(raiz, 'docs', 'openapi.json');
const comprobar = process.argv.includes('--check');

// Valores de relleno: en modo preview no se usan, pero la validacion de entorno
// corre igualmente al construir el modulo raiz.
process.env.NODE_ENV ??= 'development';
process.env.PORT ??= '3000';
process.env.DATABASE_HOST ??= 'localhost';
process.env.DATABASE_PORT ??= '55432';
process.env.DATABASE_USER ??= 'openapi';
process.env.DATABASE_PASSWORD ??= 'openapi';
process.env.DATABASE_NAME ??= 'openapi';
process.env.DATABASE_SSL ??= 'false';
process.env.REDIS_HOST ??= 'localhost';
process.env.REDIS_PORT ??= '56379';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../dist/app.module.js');
const { construirDocumentoOpenApi } = await import('../dist/docs/openapi.js');

const app = await NestFactory.create(AppModule, { preview: true, logger: false });
const documento = construirDocumentoOpenApi(app);
await app.close();

const json = `${JSON.stringify(documento, null, 2)}\n`;

if (comprobar) {
  if (!existsSync(destino)) {
    console.error('docs/openapi.json no existe. Generalo con:  npm run openapi:export');
    process.exit(1);
  }
  if (readFileSync(destino, 'utf8') !== json) {
    console.error(
      'docs/openapi.json no corresponde al codigo actual.\n' +
        'Alguien cambio la API sin regenerar la especificacion. Corrige con:\n' +
        '  npm run openapi:export',
    );
    process.exit(1);
  }
  const rutas = Object.keys(documento.paths ?? {}).length;
  console.log(`docs/openapi.json esta al dia (${rutas} ruta(s)).`);
  process.exit(0);
}

mkdirSync(path.dirname(destino), { recursive: true });
writeFileSync(destino, json, 'utf8');

const rutas = Object.keys(documento.paths ?? {});
console.log(`Escrito docs/openapi.json con ${rutas.length} ruta(s):`);
for (const r of rutas) console.log(`  ${r}`);
if (rutas.length <= 1) {
  console.log(
    '\nSolo figura la ruta base. Los endpoints de negocio apareceran aqui solos\n' +
      'segun cada modulo vaya entregando los suyos: nada se describe a mano.',
  );
}
