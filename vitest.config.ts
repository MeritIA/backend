import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      // `all` es lo que hace que la cifra sea honesta. Sin el, la cobertura se
      // calcula SOLO sobre los archivos que alguna prueba importa, asi que un
      // modulo entero sin pruebas no baja el porcentaje: simplemente no aparece.
      // El Diccionario de la EDT exige cobertura superior al 80 % como criterio
      // de terminado del proyecto, y medirlo asi no lo demostraria.
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        // Sin logica que probar: son declaraciones de modulo, DTOs con
        // decoradores, entidades y tipos.
        'src/**/*.module.ts',
        'src/**/index.ts',
        'src/**/dto/**',
        'src/**/entities/**',
        'src/database/migrations/**',
        'src/main.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
