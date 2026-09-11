// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Seccion 5 del encuadre: prohibicion tajante de `any` sin razon documentada.
      // Una excepcion puntual se marca con eslint-disable-next-line y su motivo escrito.
      '@typescript-eslint/no-explicit-any': 'error',

      // Seccion 5: prohibido tragarse errores. `catch {}` no compila el lint.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Seccion 10: una promesa sin await es una condicion de carrera esperando a ocurrir.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },

  // ---------------------------------------------------------------------------
  // Fronteras entre modulos del monolito.
  //
  // El planteamiento de arquitectura exige que ningun modulo importe una entidad
  // o un repositorio de otro, y que la regla sea "verificable por herramienta".
  // Esto es esa herramienta: cada modulo solo es alcanzable por el index.ts que
  // publica, y `npm run lint` falla si alguien se salta la frontera.
  //
  // Se usan globs y no expresiones regulares a proposito: en una cadena de
  // JavaScript '\.' se colapsa a '.', y un regex mal escapado aqui pasaria
  // desapercibido dejando la frontera sin vigilar.
  // ---------------------------------------------------------------------------
  {
    files: ['src/modules/**/*.ts'],
    ignores: ['src/modules/*/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // `../` sube al directorio de modulos; `../../` sale de modules
              // y llega a common, que si es importable.
              group: ['../*/*', '!../*/index.js', '!../../**'],
              message:
                'Frontera de modulo: de otro modulo solo se importa su interfaz publica (../<modulo>/index.js). Si necesitas algo que no esta ahi, reexportalo en su index de forma intencionada o comunica por eventos de dominio.',
            },
            {
              group: ['**/modules/*/*', '!**/modules/*/index.js'],
              message:
                'Frontera de modulo: no se accede al interior de otro modulo. Usa su index.js o un evento de dominio.',
            },
          ],
        },
      ],
    },
  },
);
