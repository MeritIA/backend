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
  //
  // La dificultad esta en que una ruta relativa no dice a que modulo pertenece:
  // `../dominio/rol.js` desde `autenticacion/servicios/` es DENTRO del propio
  // modulo, mientras que `../entregas/x.js` desde `evaluacion/` es otro modulo.
  // Se distinguen por la profundidad del archivo que importa, asi que la regla
  // se declara una vez por nivel.
  //
  // Se usan globs y no expresiones regulares a proposito: en una cadena de
  // JavaScript '\.' se colapsa a '.', y un regex mal escapado aqui pasaria
  // desapercibido dejando la frontera sin vigilar.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Pruebas de integracion.
  //
  // Excepcion acotada y con motivo, segun la regla de no conformidad: supertest
  // declara `response.body` como `any` en sus propios tipos, y no hay forma de
  // estrecharlo sin envolver la libreria entera. Comprobar la respuesta HTTP es
  // justamente lo que hacen estas pruebas, asi que la alternativa seria
  // salpicarlas de aserciones de tipo que no aportan seguridad ninguna.
  //
  // La excepcion NO alcanza a src/: alli `any` sigue siendo un error.
  // ---------------------------------------------------------------------------
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Archivos en la raiz del modulo: src/modules/<mod>/archivo.ts
  {
    files: ['src/modules/*/*.ts'],
    ignores: ['src/modules/*/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*/*', '!../*/index.js', '!../../**'],
              message:
                'Frontera de modulo: de otro modulo solo se importa su interfaz publica (../<modulo>/index.js). Si necesitas algo que no esta ahi, reexportalo en su index de forma intencionada o comunica por eventos de dominio.',
            },
          ],
        },
      ],
    },
  },

  // Archivos a un nivel: src/modules/<mod>/<sub>/archivo.ts
  // Aqui `../loquesea` sigue dentro del modulo; otro modulo es `../../<otro>`.
  {
    files: ['src/modules/*/*/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*/*', '!../../*/index.js', '!../../../**'],
              message:
                'Frontera de modulo: de otro modulo solo se importa su interfaz publica (../../<modulo>/index.js).',
            },
          ],
        },
      ],
    },
  },

  // Archivos a dos niveles: src/modules/<mod>/<sub>/<sub>/archivo.ts
  {
    files: ['src/modules/*/*/*/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../../*/*', '!../../../*/index.js', '!../../../../**'],
              message:
                'Frontera de modulo: de otro modulo solo se importa su interfaz publica (../../../<modulo>/index.js).',
            },
          ],
        },
      ],
    },
  },

);
