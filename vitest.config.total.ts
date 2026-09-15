import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Suite completa: unitarias + integracion en una sola ejecucion.
 *
 * Existe para producir UNA cifra de cobertura, que es la que el Diccionario de
 * la EDT exige como criterio de terminado ("cobertura de pruebas unitarias
 * superior al 80 %"). Medir cada suite por separado da dos numeros que nadie
 * sabe sumar, y ninguno de los dos es el del proyecto.
 *
 * Necesita el entorno levantado: docker compose up -d
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/integracion/**/*.int-spec.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
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
      // lcov lo consume SonarQube en la CI para mostrar la cobertura junto al analisis.
      reporter: ['text', 'html', 'lcov'],
      // El umbral del Diccionario, aplicado por la herramienta: por debajo, la
      // ejecucion falla. Un criterio de aceptacion que no se comprueba solo es
      // una intencion, no un criterio.
      thresholds: { statements: 80, lines: 80, functions: 80, branches: 70 },
    },
  },
});
