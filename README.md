# MeritIA · backend

Contratación por mérito: una empresa publica un reto, los candidatos entregan,
una IA califica contra una rúbrica con pesos, y el reclutador ve un ranking con
la identidad oculta hasta que decide revelarla.

**NestJS 12 + TypeScript estricto + PostgreSQL + Redis + almacenamiento S3.**
Monolito modular: siete módulos, un esquema de base de datos por módulo.

- **Qué está hecho y qué falta:** [`docs/estado-del-proyecto.md`](docs/estado-del-proyecto.md)
- **Por qué cada decisión:** [`docs/adr/`](docs/adr/) — catorce, cada una con la alternativa descartada
- **Arquitectura por módulo:** [`docs/arquitectura.md`](docs/arquitectura.md)
- **El contrato:** [`docs/openapi.json`](docs/openapi.json), y en caliente en `/docs`

## Levantarlo, de cero

Hace falta **Docker** y **Node 24**. Son cinco comandos y el último dice con
qué usuario entrar.

```bash
cp .env.example .env            # rellena DATABASE_PASSWORD con lo que quieras
npm run claves:generar          # imprime ENCRYPTION_KEY y las dos de PASETO
```

`claves:generar` **no escribe nada**: imprime tres valores y los copias al
`.env`. Son las claves de cifrado y de firma de sesión; sin ellas el backend no
arranca, y a propósito: un valor por omisión aquí sería una clave conocida.

```bash
docker compose up -d            # postgres, redis y almacenamiento
npm ci
npm run doctor                  # ANTES de nada: ver abajo
npm run migration:run
node --env-file=.env dist/main.js
```

En otra terminal, datos para mirar:

```bash
node --env-file=.env scripts/sembrar-demo.mjs
```

Deja una empresa, un reclutador, cuatro candidatos y **tres vacantes en estados
distintos** —una a medias, una vencida y una sin invitados—, porque el panel se
ve vacío y correcto con una sola. Al terminar imprime el usuario:

| Quién | Correo | Contraseña |
|---|---|---|
| Reclutadora | `laura@empresa-demo.com` | `una-frase-larga-y-dificil` |
| Candidatos | `ana@`, `luis@`, `sara@`, `diego@` `ejemplo.com` | la misma |

Son datos de demostración en tu máquina. **No sirven en ningún otro sitio** y
el script no corre en integración continua.

### `npm run doctor`, y por qué existe

Si tienes un PostgreSQL instalado en el sistema, escucha en el mismo puerto que
el contenedor y las conexiones acaban en la instancia equivocada. El único
síntoma es `password authentication failed`, que no apunta a la causa y cuesta
una tarde. `doctor` lo detecta y lo dice en una línea. **Córrelo antes de abrir
un issue por algo que no arranca.**

Por eso los puertos publicados son `15432`, `16379` y `18333` y no los de
siempre: para no chocar con lo que ya tengas.

### `npm start` no funciona, y no es tu máquina

```
SASL: client password must be a string
```

`nest start` no carga `.env`, y algo lee `process.env` antes de que
`ConfigModule` lo rellene. El rodeo es `node --env-file=.env dist/main.js`,
igual que hace `migration:run`. **Está sin arreglar** y apuntado en el estado
del proyecto.

## Probarlo

```bash
npm test                 # 288 unitarias, sin Docker, ~25 s
npm run test:integracion # 298 contra PostgreSQL y Redis de verdad
npm run test:total       # las 586 juntas, con cobertura
npm run verificar        # lo mismo que la CI, antes de abrir el PR
```

**Las de integración necesitan `docker compose up -d`**, usan la base de datos
`meritia_test` y la base lógica 1 de Redis, y la vacían al empezar: no pisan
tus datos de demostración.

Lo que se prueba contra servicios reales, y no con un doble, es deliberado:
nada de lo que importa aquí —aislamiento entre empresas, cifrado de columnas,
cuotas de subida— se comporta igual contra un doble que contra PostgreSQL.

### El servicio de IA es opcional

Sin `AI_SERVICE_URL` entra el **evaluador honesto**: falla con un motivo claro
en vez de inventar una nota, y `/api/v1/salud` lo reporta como
`sin_configurar` sin tumbar el backend. Para evaluar de verdad hace falta
[`../ai-service`](../ai-service) corriendo, y después:

```bash
node --env-file=.env scripts/humo-evaluacion.mjs
```

Gasta cuota real de Gemini. Por eso `sembrar-demo` escribe las evaluaciones
directamente: pintar una barra de progreso no justifica el gasto.

## Lo que hay que saber antes de tocar código

Cuatro cosas que no se adivinan leyendo un archivo suelto.

**Los datos personales están cifrados en columna.** `correo`,
`nombre_completo` y `archivo_nombre` pasan por un *transformer* AES-256-GCM. Un
`insert` a mano les mete texto en claro, nadie se entera hasta que algo las lee,
y entonces revienta con `Formato invalido: se esperaba iv:authTag:ciphertext`.
Pasó al sembrar la primera vez. **Todo lo que pueda pasar por la API, pasa por
la API.**

**Un recurso de otra empresa devuelve 404, no 403.** Un 403 confirma que el
identificador existe, y eso ya es información. Está en
[ADR-0012](docs/adr/0012-404-en-vez-de-403.md) y hay pruebas que lo fijan: si
cambias uno a 403, la suite se pone roja a propósito.

**La sesión va en cookie `HttpOnly` para web y en el cuerpo para la APK.** El
cliente se declara (`cliente: 'web'`), no se adivina por `User-Agent`. En
producción la cookie es `Secure`, así que **sobre HTTP la sesión no funciona**:
el login responde 200 y la siguiente petición va sin sesión.

**La IA nunca recibe el archivo.** Recibe texto extraído y saneado
([ADR-0008](docs/adr/0008-la-ia-no-recibe-archivos.md)). Un `.ipynb` con una
instrucción escondida es la vía de inyección obvia, y el servicio de IA tiene
dos capas de detección propias.

## Cómo se trabaja aquí

Rama por paquete de la EDT, commits pequeños, y **el PR se abre con
`npm run verificar` en verde**. La CI corre cinco verificaciones:

| | Qué mira |
|---|---|
| Secretos | Gitleaks sobre **todo el historial**, no solo el diff |
| Dependencias | `npm audit` |
| Lint, build y contrato | Falla si `openapi.json` no está al día |
| Pruebas y cobertura | Las 586 contra servicios reales, y sube la cobertura |
| Análisis estático | SonarQube Cloud |

Si tocas un controlador, `npm run openapi:export` y commitea el JSON. La CI
compara, y es el aviso de que cambiaste el contrato sin darte cuenta.

**No hay protección de rama**: la organización está en plan gratuito con
repositorios privados y GitHub cobra por eso. Las cinco verificaciones son una
convención, no una puerta. Se puede empujar a `main` roto, así que no se hace.

### Nunca en Git

Claves, tokens, contraseñas ni cadenas de conexión. Hay `.env.example` y
`.gitignore` para eso, y Gitleaks mira el historial completo en cada PR.

## Desplegarlo

[`docs/despliegue.md`](docs/despliegue.md). Resumen: un VPS con Docker,
`compose.produccion.yaml`, la imagen que la CI publica en GHCR por digest, y
Caddy delante con TLS automático.

**Hace falta un dominio y no es una preferencia:** la cookie es `Secure` en
producción y Let's Encrypt no emite certificados para una IP. Un subdominio
gratuito de DuckDNS sirve.

El workflow existe y está escrito, y está **apagado** detrás de la variable
`DESPLIEGUE_HABILITADO`: encenderla sin servidor deja `main` fallando en cada
commit. Nadie ha desplegado todavía.
