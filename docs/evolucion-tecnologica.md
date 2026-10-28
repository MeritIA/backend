# Plan de actualización tecnológica

El review del 26/10 lo pide con estas palabras: «el monolito y cómo va cambiando
a lo largo del tiempo». Son dos preguntas distintas y van las dos:

1. **Cómo crece la arquitectura** — qué se parte, en qué orden, y **a qué número**.
2. **Cómo se mantienen al día las dependencias** — que es la otra cosa que
   «actualización tecnológica» significa, y la que de verdad rompe proyectos.

La regla de todo este documento: **cada etapa tiene un disparador medible**. Un
plan de escalado sin números es una lista de deseos, y lleva a partir el sistema
el día que alguien se aburre en vez del día que hace falta.

## 1. Dónde estamos: etapa 0

Un proceso, siete módulos, PostgreSQL y Redis. Lo medido con `k6`
(`rendimiento.md`):

| Medida | Valor |
|---|---|
| Caudal sano | **79 pet/s** (30 iteraciones/s de flujo completo) |
| p95 en carga sana | **83 ms** |
| Punto de caída | **50 it/s** |
| Pico antes del colapso | 106 pet/s, y después 78 y 57 |
| CPU del proceso | **128 % de un núcleo**, en una máquina de ocho |
| Conexiones de base | 11 de 100 |

La conclusión que ordena todo lo que sigue: **no hay una consulta lenta que
optimizar, hay siete núcleos sin usar**. Node es de un hilo, y el proceso ya lo
tiene lleno mientras el resto de la máquina está libre.

Traducido a producto: 79 pet/s sostenidas dan de sobra para decenas de
convocatorias simultáneas con cientos de candidatos. La etapa 0 no es una etapa
provisional; es la correcta hasta que los números digan otra cosa.

## 2. Cómo crece

### Etapa 1 — Varias copias del mismo proceso

**Disparador:** el control de admisión (ADR 0011) empieza a devolver 503 de
forma sostenida, o la CPU del proceso se queda pegada al 100 % de su núcleo con
p95 por encima del objetivo.

**Qué se hace:** correr N copias del proceso detrás de un balanceador. Ganancia
esperada: lineal hasta llenar los ocho núcleos, porque el cuello es CPU de un
hilo y no la base.

**Qué hay que arreglar antes, y es concreto:** los contadores de alertas viven
**en memoria del proceso**. Con varias copias, cada una contaría sus propios
avisos y el umbral de alerta tardaría N veces más en dispararse. Hay que
moverlos a Redis. Es la única pieza con estado en memoria que queda; lo demás ya
está listo: las sesiones no guardan estado en el servidor (ADR 0005), el rate
limiting ya cuenta en Redis y la cola ya es compartida.

**Coste:** un balanceador y N veces la memoria. Ningún cambio de arquitectura.

### Etapa 2 — El trabajador de evaluación, aparte del web

**Disparador:** la cola crece de forma sostenida (`GET /evaluaciones/cola`) **y**
las peticiones web empeoran al mismo tiempo. Las dos cosas juntas: una cola
larga por un proveedor lento no se arregla separando procesos.

**Qué se hace:** levantar los mismos contenedores con
`COLA_WORKER_HABILITADO=false` para los que atienden HTTP y `true` para los que
consumen la cola. **El interruptor ya existe** (ADR 0007): esta etapa es
configuración, no desarrollo.

**Coste:** dos despliegues con la misma imagen y dos cosas que vigilar.

### Etapa 3 — Reportes proyectados por evento

**Disparador:** el informe de una vacante pasa de ~500 ms en p95, o entra la
analítica avanzada que la Declaración de Alcance excluye del MVP.

**Qué se hace:** escuchar `evaluacion.evaluacion-finalizada` —que el paquete 4.5
ya publica, justo para esto— y mantener una tabla con la forma del informe.

**Coste, y es el que el ADR 0010 rechazó hasta ahora:** una copia que se puede
desincronizar. Si se llega aquí, hace falta además una forma de reconstruirla
desde cero y una comprobación periódica de que coincide con la evaluación.

### Etapa 4 — Un módulo a servicio propio

**Disparador: organizativo, no técnico.** Se parte cuando dos personas distintas
necesitan desplegar a ritmos distintos y se pisan. Partir por volumen antes de
eso solo añade llamadas de red que pueden fallar solas (ADR 0001).

**Por dónde se parte, en orden de facilidad:**

1. **Evaluación.** Ya tiene media frontera de proceso: habla con `ai-service` por
   HTTP y su trabajo entra por una cola, no por una llamada de función.
2. **Reportes.** Solo lee, así que no hay transacción que partir. Pero lee de
   cuatro módulos, así que como servicio pasaría a hacer cuatro llamadas de red
   donde hoy hace cuatro de función.
3. **El resto.** Autenticación, vacantes, ejercicios y entregas comparten
   transacciones y fronteras de autorización. Partirlos es el proyecto grande.

**Qué lo hace posible hoy:** el esquema por módulo sin claves foráneas cruzadas
(ADR 0002). Mover un módulo a su base es cambiar una cadena de conexión, no
rediseñar el esquema.

### Etapa 5 — La base de datos

**Disparador:** contención en PostgreSQL, que hoy no existe (11 conexiones de
100).

**En orden:** réplica de lectura para los informes → esquema de un módulo a su
propia instancia → particionar la tabla de evaluaciones por fecha, que es la
única que crece sin techo.

## 3. Cómo se mantienen las dependencias al día

Esta mitad del plan es la que de verdad quiebra proyectos, y este ya tiene una
cicatriz que lo demuestra.

**La lección de MinIO.** El 11/09/2026 MinIO retiró sus imágenes públicas de
Docker Hub. El entorno de desarrollo dejó de levantarse y la CI estuvo en rojo
**semanas** sin que nadie lo mirara. No fue un fallo de código: una dependencia
desapareció. De ahí tres prácticas que ya están puestas:

- **Versiones exactas en las imágenes de Docker**, no `latest`. Una imagen que
  cambia sola convierte un despliegue en una lotería.
- **Acciones de GitHub ancladas por SHA**, no por etiqueta. Una etiqueta se
  puede reescribir; un SHA no.
- **Reemplazos elegidos midiendo**, no leyendo: SeaweedFS entró porque pasó las
  14 pruebas de almacenamiento del proyecto (ADR 0009).

**Cadencia.** Dependabot abre los PR; el equipo los agrupa semanalmente. Los
`patch` y `minor` entran si la CI está verde —cinco verificaciones: Gitleaks,
`npm audit`, lint/build/contrato, 544 pruebas con cobertura, y SonarQube—. Las
**mayores se tratan de una en una**, cada una en su rama, porque una mayor es un
cambio de comportamiento y no una actualización.

**Mayores pendientes hoy, con lo que cuesta cada una:**

| Dependencia | Salto | Qué hay que mirar |
|---|---|---|
| `paseto` | 3 → 4 | Es la autenticación entera. Toca verificar que la firma Ed25519 y el formato de los tokens existentes sigan valiendo, o planear una rotación |
| `vitest` | 4 → 5 | 493 pruebas y la medición de cobertura dependen de él |

**La base del tiempo de ejecución.** Node 24.16 (fijado en `.nvmrc`), NestJS 12,
TypeORM 1.1, PostgreSQL 17. La regla: se actualiza a la siguiente versión LTS de
Node en los tres meses siguientes a su salida, no el día uno, y nunca durante la
semana de una entrega.

## 4. Lo que no se va a hacer, y por qué

Se escribe para que no vuelva a discutirse cada mes:

- **Microservicios ahora.** El coste se paga el primer día y el beneficio llega
  con una escala que no existe (ADR 0001).
- **Kubernetes.** Tres personas y un producto sin usuarios no necesitan un
  orquestador; necesitan que `docker compose up` funcione, que es lo que hay.
- **Cambiar a GraphQL.** El problema que resuelve aquí es pequeño y el que trae
  —autorización repartida por resolver— es justo el riesgo principal del
  producto (ADR 0004).

## 5. Lo que este plan no cubre

Dicho para que no se lea como más completo de lo que es:

- **No hay entorno desplegado ni despliegue continuo.** Todo lo anterior describe
  cómo crecería un sistema que hoy solo corre en local y en la CI. La etapa 1 no
  se puede empezar sin resolver eso primero.
- **El soak de horas sigue pendiente** (RNF-REN-6): sin él no se puede afirmar
  que no haya fuga de memoria, y una fuga aparece justo cuando se corren varias
  copias durante días.
- **La rotación de la clave de cifrado** no está resuelta (ADR 0006), y es un
  requisito de operación, no de escalado.
