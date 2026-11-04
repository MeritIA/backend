# Pruebas de carga (sección 11 del encuadre)

Cuatro escenarios con **Grafana k6**, más uno dedicado a evaluaciones
concurrentes. Las cifras medidas y los requisitos que se derivaron de ellas
están en [`docs/rendimiento.md`](../../docs/rendimiento.md).

## Por qué no corren en la integración continua

Una corrida completa son unos veinte minutos y necesita el entorno en pie. Lo
que sí tiene que correr en cada push son las 413 pruebas; esto se corre cuando
se toca algo que afecta al rendimiento, y antes de cada entrega del piloto.

## Las cuatro piezas

| Pieza                                        | Qué hace                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `doble-servicio-ia.mjs`                      | Suplanta al servicio de IA con latencia simulada. La sección 11 lo pide: un _soak_ contra Gemini cuesta dinero y choca con su _rate limit_ |
| `preparar-datos.mjs`                         | Crea la base `meritia_carga`, migra, y siembra reclutador, ejercicio, vacante publicada y candidatos invitados con sus tokens              |
| `muestrear-recursos.mjs`                     | CPU, memoria y conexiones a la base, que k6 no ve                                                                                          |
| `baseline/stress/spike/soak/evaluaciones.js` | Los escenarios                                                                                                                             |

## Procedimiento

### 1. Entorno de carga, aparte del de desarrollo

```bash
# .env.carga = tu .env con estos cambios
NODE_ENV=production
DATABASE_NAME=meritia_carga        # base aparte: una corrida crea miles de filas
REDIS_DB=2                         # 0 es desarrollo, 1 las pruebas
COLA_WORKER_HABILITADO=true        # sin worker no se evalúa nada
AI_SERVICE_URL=http://127.0.0.1:13100
AI_SERVICE_API_KEY=clave-del-doble-de-carga
ALLOWED_ORIGINS=http://localhost:4200
LOG_LEVEL=warn
THROTTLE_IP_LIMIT=1000000          # ver la nota de abajo
THROTTLE_USER_LIMIT=1000000
THROTTLE_LOGIN_LIMIT=1000000
THROTTLE_SUBMISSION_LIMIT=1000000
THROTTLE_EVALUACION_LIMIT=1000000
```

**Los límites de peticiones se suben a propósito, y hay que saber por qué.** El
límite real es de 100 por minuto y por IP. k6 corre desde un solo contenedor,
así que con el límite puesto lo que se mediría es el limitador y no la
aplicación: a los seis segundos todo serían 429. El _rate limiting_ tiene sus
propias pruebas de integración, donde sí se comprueba que funciona.

`.env.carga` está en `.gitignore`.

### 2. Levantar las piezas

```bash
docker compose up -d --wait postgres redis almacenamiento
npm run build

node --env-file=.env.carga test/carga/doble-servicio-ia.mjs    # terminal 1
node --env-file=.env.carga dist/main                            # terminal 2
node --env-file=.env.carga test/carga/preparar-datos.mjs        # una vez
node --env-file=.env.carga test/carga/muestrear-recursos.mjs    # terminal 3
```

`preparar-datos.mjs` crea la base y migra por su cuenta, pero el backend no
arranca si la base no existe todavía. La primera vez, el orden es: crear y
migrar, levantar el backend, y volver a correr el preparador para que siembre.

### 3. Correr un escenario

```bash
docker run --rm -v "$PWD/test/carga:/carga" -w /carga \
  -e CARGA_URL_BASE=http://host.docker.internal:3000 \
  grafana/k6 run baseline.js
```

Variables: `CARGA_RPS`, `CARGA_DURACION`, `CARGA_PCT_ENTREGAS` y, para `mentor`, `CARGA_PCT_PREGUNTAS`.

Para medir el mentor hay que sembrar con `preparar-datos.mjs` (deja 3 evaluaciones por candidato) y para ver si afecta al resto, correr `mentor` y `baseline` a la vez.

## Los escenarios

| Escenario          | Forma                          | Qué responde                                                |
| ------------------ | ------------------------------ | ----------------------------------------------------------- |
| `baseline`         | ritmo constante                | Cómo se comporta en carga normal                            |
| `stress`           | escalones hasta 400/s          | **Dónde está el límite**                                    |
| `spike`            | de 5 a 250/s en diez segundos  | Si aguanta el pico y, sobre todo, si **recupera**           |
| `soak`             | sostenido, por omisión 10 min  | **Deriva**: memoria, conexiones, latencia con el tiempo     |
| `evaluaciones`     | todas las iteraciones entregan | El camino caro: archivo, almacenamiento, transacción y cola |
| `mentor`           | resumen + pregunta a la IA     | Si el mentor aguanta, y si **deja** aguantar al resto       |
| `registro-empresa` | altas de empresa (argon2id)    | Cuánto cuesta cada alta pública y si una rafa deja sin CPU  |

`stress` va **sin umbrales** a propósito: busca el punto de rotura, así que un
umbral que falle no informaría de nada. El dato es _dónde_ se rompe.

## Dos límites de este montaje, para leer las cifras con honestidad

1. **El doble no simula el cómputo del modelo**, solo su latencia. Lo que se
   mide es el backend: cola, base de datos, almacenamiento y proceso de Node.
2. **Todo corre en una sola máquina**, la de desarrollo: el generador de carga,
   la aplicación y las tres dependencias compiten por la misma CPU. Los números
   son un piso, no un techo; en una máquina dedicada serán mejores.

## El techo de entregas

Un candidato puede entregar como máximo `intentosPermitidos` veces por
ejercicio, por la restricción única de la tabla. El techo de toda la corrida es
`candidatos × intentos`, que el preparador imprime al terminar. Pasado ese
punto llegan 409, que **no son errores**: son la respuesta correcta del dominio
y se cuentan aparte en `entregas_sin_intentos_409`. Si hacen falta más, se
siembra con `CARGA_CANDIDATOS` más alto.
