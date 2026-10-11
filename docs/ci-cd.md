# Integración y despliegue continuos

> Paquete **1.2** de la EDT. Plan de Seguridad §10.

Un solo pipeline, `.github/workflows/ci.yml`, para un solo artefacto: la imagen
Docker del backend.

## Qué hace

| Trabajo | Cuándo | Falla si |
|---|---|---|
| **Secretos** (Gitleaks) | Todo push y PR | Hay un secreto en **cualquier commit del historial** |
| **Dependencias** (`npm audit`) | Todo push y PR | Hay una vulnerabilidad **crítica** |
| **Lint, build y OpenAPI** | Todo push y PR | Lint, formato o compilación fallan, o `docs/openapi.json` no corresponde al código |
| **Pruebas y cobertura** | Todo push y PR | Una prueba unitaria o de integración falla, o la cobertura baja del umbral (80 % sentencias, líneas y funciones; 70 % ramas) |
| **Análisis estático** (SonarQube Cloud) | Tras las pruebas | La *quality gate* no pasa. Si no está configurado, avisa y no bloquea |
| **Artefacto** | Solo push a `main`, con todo lo anterior en verde | — Publica `ghcr.io/meritia/backend` |
| **Despliegue** | Tras el artefacto, si `DESPLIEGUE_HABILITADO=true` | Faltan secretos del ambiente (y hoy, siempre: ver abajo) |

Las pruebas de integración corren contra PostgreSQL, Redis y el almacenamiento levantados
con el mismo `compose.yaml` del entorno local, con las mismas versiones de
imagen.

## Los tres criterios de aceptación

**1. La construcción falla ante un secreto, una vulnerabilidad crítica o una
prueba en rojo.** El artefacto depende (`needs`) de los trabajos de secretos,
dependencias, calidad y pruebas: si cualquiera falla, no hay imagen.

**2. Los secretos no se comparten entre ambientes.**

- Las pruebas **no usan ningún secreto guardado**. `scripts/preparar-env-ci.mjs`
  genera claves PASETO, clave AES y contraseñas en cada ejecución; mueren con
  ella y se enmascaran en los registros.
- Cada ambiente (`desarrollo`, `pruebas`, `produccion`) es un *Environment* de
  GitHub con **sus propios** secretos. El trabajo de despliegue declara su
  `environment` y no usa `secrets: inherit`, así que solo recibe los de ese
  ambiente.

**3. Un commit en `main` produce un artefacto desplegable sin intervención
manual.** Con todo en verde, se publica la imagen etiquetada con el SHA completo
del commit y con `main`. El despliegue se hace por *digest*
(`ghcr.io/...@sha256:...`), que no puede cambiar entre la construcción y el
despliegue.

## Seguridad del propio pipeline

- **Acciones fijadas por SHA**, no por etiqueta: una etiqueta se puede mover a
  código malicioso. Dependabot mantiene los SHA al día.
- **Permisos mínimos**: solo lectura por defecto; únicamente el trabajo del
  artefacto pide `packages: write`.
- **`persist-credentials: false`** en cada checkout: ningún paso posterior
  hereda el token del repositorio.

## Qué tiene que configurar el equipo en GitHub

### SonarQube Cloud (una vez)

1. Entrar en sonarcloud.io con la cuenta de GitHub e importar la organización
   `MeritIA` y el repositorio `backend`. El plan gratuito admite repositorios
   privados hasta 50 000 líneas.
2. En el repositorio, *Settings → Secrets and variables → Actions*:
   - Secreto `SONAR_TOKEN`.
   - Variables `SONAR_ORGANIZATION` y `SONAR_PROJECT_KEY`, con los valores que
     muestra SonarQube Cloud.
3. En SonarQube Cloud, desactivar el *Automatic Analysis*: el análisis lo lanza
   el pipeline, que es quien tiene la cobertura.

### Ambientes y secretos

1. *Settings → Environments*: crear `desarrollo`, `pruebas` y `produccion`.
2. En **cada uno**, sus secretos: `DATABASE_PASSWORD`, `ENCRYPTION_KEY`,
   `PASETO_PRIVATE_KEY`, `PASETO_PUBLIC_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
   Genera claves distintas por ambiente con `npm run claves:generar`.
3. **No crear esos secretos a nivel de repositorio.** Un secreto de repositorio
   es visible para todos los ambientes, que es justo lo que el criterio prohíbe.
4. En `produccion`, activar *Required reviewers*: nada llega a producción sin
   que una persona lo apruebe.

### Despliegue

El despliegue está **desactivado** mientras el proyecto no elija proveedor de
nube. Para activarlo:

1. Implementar el paso *Desplegar la imagen* en
   `.github/workflows/desplegar.yml` con el comando del proveedor.
2. Crear la variable de repositorio `DESPLIEGUE_HABILITADO=true`.

Ese paso **falla a propósito** mientras no se implemente: activar la variable
sin él no debe dar un verde que no desplegó nada.

## Ejecutar lo mismo en local

```bash
npm audit --audit-level=critical
npm run lint && npm run format:check && npm run build
node scripts/exportar-openapi.mjs --check
docker compose up -d --wait postgres redis almacenamiento
npm run test:total
```

El escaneo de secretos, con Docker:

```bash
docker run --rm -v "$PWD:/repo" -e GIT_CONFIG_COUNT=1 \
  -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
  zricethezav/gitleaks:v8.30.1 git /repo --redact --verbose
```

En Git Bash de Windows, antepón `MSYS_NO_PATHCONV=1` y usa `$(pwd -W)`.

## Falsos positivos de Gitleaks

Se registran en `.gitleaksignore` por **huella exacta**, con la explicación de
por qué no es un secreto. Nunca por patrón: un patrón silenciaría también los
secretos reales que coincidan.

Si Gitleaks encuentra un secreto **real**, excluirlo no basta: hay que
**rotarlo**, porque ya está en el historial de todos los clones.

## Fuera de este repositorio

La EDT incluye en 1.2 el build de Angular y la sincronización de Capacitor para
la APK. Eso pertenece al pipeline del repositorio `web`.

## Límites conocidos

- Repositorio privado en plan gratuito: GitHub Actions da 2000 minutos al mes.
  Una ejecución completa ronda los 6 a 10 minutos.
- CodeQL no se usa: en repositorios privados exige GitHub Advanced Security,
  que es de pago. El análisis estático lo hace SonarQube Cloud.
