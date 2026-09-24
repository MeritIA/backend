import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Pruebas de integracion: hablan con PostgreSQL y Redis de verdad.
 *
 * Van en su propia configuracion y con otra extension (.int-spec.ts) para que
 * `npm test` siga siendo rapido y no dependa de tener el entorno levantado. La
 * suite unitaria tiene que poder correr en cualquier maquina y en cualquier
 * momento; esta necesita `docker compose up -d` delante.
 */
export default defineConfig({
  // SWC y no el transformador por defecto: esbuild no emite los metadatos de
  // decoradores (`design:type`) que NestJS necesita para inyectar dependencias
  // y TypeORM para conocer los tipos de columna. Sin esto habria que ejecutar
  // dist/, y entonces la cobertura se mediria sobre el compilado y no sobre el
  // codigo fuente: los servicios figurarian al 0 % aun estando probados.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    root: './',
    include: ['test/integracion/**/*.int-spec.ts'],
    // Sin paralelismo: comparten una base de datos y se vacian las tablas entre
    // casos. En paralelo se pisarian y los fallos serian intermitentes, que es
    // la peor clase de fallo.
    fileParallelism: false,
    sequence: { concurrent: false },
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.module.ts',
        'src/**/index.ts',
        'src/**/dto/**',
        'src/**/entities/**',
        'src/database/migrations/**',
        'src/main.ts',
      ],
      reporter: ['text'],
    },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
