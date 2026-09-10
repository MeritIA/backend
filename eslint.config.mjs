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
);
