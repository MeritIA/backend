# Rendimiento: lo que se midió y lo que se exige

Sección 11 del encuadre. Cómo repetir las mediciones está en
[`test/carga/README.md`](../test/carga/README.md).

Medido el **2026-10-06** con Grafana k6, contra el backend en modo producción,
PostgreSQL 17.6, Redis 8.2 y SeaweedFS 4.48.

## Antes de leer cualquier número

Dos límites del montaje. Sin ellos, las cifras se leen mal:

1. **Todo corrió en una sola máquina de desarrollo** (8 núcleos): el generador
   de carga, la aplicación y las tres dependencias compiten por los mismos
   núcleos. **Los números son un piso, no un techo.**
2. **El servicio de IA es un doble** con latencia simulada (1,5 s ± 0,5 s). La
   sección 11 lo pide así: un _soak_ contra Gemini cuesta dinero y choca con su
   _rate limit_. El doble simula la latencia del proveedor, **no su cómputo**.

Y una regla de conducta que la propia sección 11 impone: _no afirmar que el
sistema es rápido sin datos_. Lo que sigue son datos; lo que no se midió, se
dice.

## 1. Carga normal

10 iteraciones/s durante 2 minutos. **3.046 peticiones, 25,4 pet/s, cero
errores.**

| Operación                  | p50     | p95     | p99      |
| -------------------------- | ------- | ------- | -------- |
| Listar vacantes            | 7,1 ms  | 15,2 ms | 33,4 ms  |
| Mis entregas               | 5,8 ms  | 13,6 ms | 22,1 ms  |
| Mis evaluaciones           | 7,0 ms  | 12,6 ms | 19,3 ms  |
| Evaluaciones de la vacante | 12,5 ms | 28,3 ms | 40,7 ms  |
| Reporte consolidado        | 15,9 ms | 31,9 ms | 63,6 ms  |
| Entregar archivo           | 33,9 ms | 68,8 ms | 273,9 ms |

El reporte del paquete 5.1 compone cuatro módulos en cada consulta y se queda
en **64 ms de p99**. Era la duda principal al decidir que ese módulo no tuviera
esquema propio; con este dato, la decisión se sostiene.

## 2. Dónde cae: barrido escalón por escalón

Cada ritmo en una corrida aparte, 45 s, sobre base recién creada. Los criterios
se fijaron **antes** de medir, para no acomodarlos al resultado:

- **SANO** — p95 < 500 ms, cero iteraciones descartadas, cero errores.
- **DEGRADADO** — p95 < 2 s y menos del 5 % descartadas.
- **CAÍDO** — p95 ≥ 2 s, o ≥ 5 % descartadas, o > 1 % de errores inesperados.

| it/s | pet/s | p50      | p95      | p99      | Reporte p95 | Entregar p95 | Descartadas | Estado    |
| ---- | ----- | -------- | -------- | -------- | ----------- | ------------ | ----------- | --------- |
| 10   | 27    | 6 ms     | 21 ms    | 35 ms    | 33 ms       | 36 ms        | 0 %         | **SANO**  |
| 20   | 53    | 7 ms     | 25 ms    | 71 ms    | 62 ms       | 36 ms        | 0 %         | **SANO**  |
| 30   | 79    | 9 ms     | 83 ms    | 190 ms   | 242 ms      | 148 ms       | 0 %         | **SANO**  |
| 40   | 106   | 14 ms    | 1.176 ms | 2.011 ms | 2.137 ms    | 1.781 ms     | 0,1 %       | DEGRADADO |
| 50   | 78    | 331 ms   | 2.881 ms | 4.187 ms | 4.101 ms    | 5.396 ms     | 4,7 %       | **CAÍDO** |
| 60   | 131   | 3.475 ms | 6.559 ms | 9.477 ms | 8.070 ms    | 10.991 ms    | 15,8 %      | CAÍDO     |

**Capacidad sana: 30 it/s ≈ 79 pet/s. Punto de caída: 50 it/s.**

### Cae por latencia, nunca por error

En **ningún** escenario hubo una sola respuesta inesperada. Bajo saturación el
sistema no se equivoca: se vuelve inusable. Listar vacantes pasó de 7 ms a
3,5 s de mediana. Eso es una buena noticia sobre la corrección y una mala sobre
la operación.

### El hallazgo que manda en el plan: colapso por congestión

El rendimiento máximo está en el codo —**106 pet/s**— y a partir de ahí
**baja**: 78, y en el _stress_ hasta 57 pet/s. Con más carga, el sistema hace
**menos** trabajo. No se degrada de forma elegante: se ahoga y empeora solo.

| Escenario | Pedido            | Logrado               | Descartadas | p95    |
| --------- | ----------------- | --------------------- | ----------- | ------ |
| Stress    | 400 it/s          | 47,5 it/s (124 pet/s) | 15.146      | 6,18 s |
| Spike     | 250 it/s de golpe | 31,2 it/s (84 pet/s)  | 6.616       | 5,82 s |

## 3. El estado acumulado pesa, y no se sabe cuánto

El mismo ritmo de 20 it/s dio **25 ms de p95 sobre base nueva** y **541 ms
sobre base usada** (unas 1.100 entregas y evaluaciones, más el worker
procesando atrasos). **Veintiún veces, con la misma carga.**

Hay dos causas plausibles y **no se ha determinado cuál manda**: las filas
acumuladas encareciendo el reporte, o el worker de la cola compitiendo por el
_event loop_. Queda como medición pendiente (P5), no como conclusión.

## 4. Quién es el cuello de botella

| Recurso                     | Máximo                   | Veredicto            |
| --------------------------- | ------------------------ | -------------------- |
| Conexiones a PostgreSQL     | **11 de 100**            | No es el pool        |
| CPU de PostgreSQL           | 110 %                    | Trabaja, no se ahoga |
| CPU de Redis                | 14 %                     | Irrelevante          |
| CPU del almacenamiento      | 17 %                     | Irrelevante          |
| **CPU del proceso de Node** | **128 %, promedio 66 %** | **Aquí está**        |
| Memoria del backend         | 200 → 628 MB             | Sin conclusión       |

La máquina tiene **8 núcleos** y en el punto de caída el sistema entero usa
**~1,3**. El backend es un proceso de Node: un hilo, un núcleo. Siete están
mirando.

**No hay una consulta lenta que optimizar. Hay siete núcleos sin usar.**

## 5. Requisitos no funcionales, derivados de lo medido

Antes no existían: no hay documento que fije objetivos de rendimiento para
MeritIA. Estos salen de las cifras de arriba, que es el único modo honesto de
escribirlos. **Se cumplen o no según la medición, y se dice cuál es cuál.**

|           | Requisito                                                                                                      | Estado                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **RNF-1** | Sostener **≥ 75 pet/s** (30 it/s) en una instancia, con 8 núcleos compartidos                                  | ✅ medido: 79 pet/s                                        |
| **RNF-2** | p95 en capacidad sana: lecturas simples ≤ 100 ms, reporte consolidado ≤ 250 ms, entrega de archivo ≤ 300 ms    | ✅ medido: 83 / 242 / 148 ms                               |
| **RNF-3** | **Cero respuestas inesperadas** hasta el punto de caída                                                        | ✅ medido: 0 en todos los escenarios                       |
| **RNF-4** | Pasado el punto de caída, rechazar explícitamente (**503 + `Retry-After`**) y mantener el rendimiento del pico | ⚠️ **mecanismo implementado, efecto sin medir**: ver abajo |
| **RNF-5** | Tras un pico, volver al p95 de capacidad sana en ≤ 60 s                                                        | ⚠️ **no medible todavía**: falta serie de tiempo           |
| **RNF-6** | Sin crecimiento sostenido de memoria bajo carga constante                                                      | ⚠️ **no verificado**: falta un _soak_ de horas             |

Tres cumplidos con número, uno a medias y dos sin poder afirmar nada.

### Sobre el RNF-4: el mecanismo existe, el efecto no está medido

El control de admisión del P1 **está implementado y probado** (§5.9 de
[`arquitectura.md`](arquitectura.md)): pasado el tope, el backend responde 503
con `Retry-After` antes incluso de autenticar, y las rutas de salud nunca se
rechazan. Dieciséis pruebas lo cubren, incluidas las de que un rechazo no ocupa
cupo y que el contador no queda en negativo.

**Pero la segunda mitad del requisito —"mantener el rendimiento del pico"— es
una afirmación sobre carga, y todavía no se ha vuelto a medir.** La tríada del
encuadre es medir, corregir y **volver a medir**, y el tercer paso falta. Hasta
repetir el barrido no se puede decir que el RNF-4 se cumpla: solo que ya existe
con qué cumplirlo.

El criterio de la verificación pendiente está fijado: **`pet/s` no debe caer
después del codo**. Hoy caía de 106 a 78 y a 57.

## 6. Plan de mejora

Ordenado por evidencia y retorno.

### P1 — Control de admisión

**Evidencia:** pasado el codo el rendimiento baja (106 → 78 → 57 pet/s).

**Acción:** limitar peticiones en vuelo y responder **503 con `Retry-After`** al
pasar el umbral. No sustituye al _rate limiting_: ese protege de abuso por
origen, esto protege al proceso de sí mismo.

**Efecto esperado:** el rendimiento se mantiene plano en el pico en vez de
derrumbarse; el exceso recibe una respuesta clara y rápida.

**Verificación:** repetir el barrido. Criterio: `pet/s` **no cae** tras el codo.

**Va primero** porque es lo único que cambia el comportamiento bajo abuso, es
barato, y arregla el peor caso en vez del promedio.

### P2 — Usar los otros siete núcleos

**Evidencia:** 8 núcleos, ~1,3 en uso, Node de un solo hilo.

**Acción:** varias instancias detrás de un balanceador. La aplicación ya es
apta: PASETO sin estado, _rate limiting_ en Redis, cola en BullMQ.

**Prerrequisito, no extra:** los contadores de alertas viven **en memoria**
(§5.8). Con N instancias cada una cuenta las suyas y los umbrales se alcanzan N
veces más tarde. **Pasarlos a Redis va antes de escalar.**

**Efecto esperado:** cerca de lineal en lecturas; la capacidad sana debería
pasar de 30 it/s a 100 o más con cuatro instancias.

### P3 — Sacar el worker de la cola del proceso de la API

**Evidencia:** la diferencia de 21× entre base limpia y usada.

**Acción:** proceso aparte. **La bandera ya existe**
(`COLA_WORKER_HABILITADO`): es configuración y despliegue, no código.

**Efecto esperado:** la latencia de la API deja de depender de cuántas
evaluaciones se estén procesando.

### P4 — Medir el coste por petición antes de tocarlo

**Evidencia:** el cuello es CPU del proceso, y cada petición verifica una firma
Ed25519 **y** consulta el usuario en la base.

**Acción:** perfilar para atribuir ese costo. **Es una medición, no una
optimización.** Con 11 conexiones de 100 nada señala a la base.

**Si el perfil lo justifica**, cachear la consulta del usuario unos segundos
—con el costo dicho en voz alta: una cuenta desactivada seguiría abriendo
puertas durante ese tiempo, y esa comprobación por petición está puesta a
propósito.

### P5 — Medir con datos acumulados

Sembrar decenas de miles de evaluaciones y medir el reporte. Dirá si hace falta
un índice o si la proyección que **se decidió no construir** en el 5.1 termina
siendo necesaria. Si lo es, la decisión cambia con un dato.

### P6 — Un _soak_ de verdad

Horas, no diez minutos, mirando la pendiente. Hoy **no se puede afirmar** si hay
fuga o si es el _heap_ de V8 que no devuelve memoria al sistema operativo.

## 7. Lo que NO hay que hacer todavía

Tocar consultas, añadir caché, subir el pool o afinar PostgreSQL. La evidencia
dice que **ninguno es el cuello**: 11 conexiones de 100, Redis al 14 %,
almacenamiento al 17 %. Hacerlo ahora sería optimizar sin evidencia, que es lo
que la sección 9 prohíbe.

## 8. Deuda del método de medición

1. El resumen agregado del _spike_ **no puede decir si recuperó** tras el pico,
   que es justo para lo que ese escenario existe. Necesita series de tiempo.
2. **Resembrar antes del escenario de entregas**: el barrido se come el techo de
   intentos y deja ese escenario midiendo 409s. Pasó dos veces.
3. Medir en una máquina donde el generador de carga no compita por los mismos
   núcleos.

## 9. Mentor IA y auto-registro de empresa (04/11/2026)

Dos escenarios nuevos, `mentor.js` y `registro-empresa.js`, con k6 sobre el
mismo montaje de la sección 1 (producción, base `meritia_carga`, doble de IA con
800 ms para el mentor, límites de peticiones subidos). Cada candidato sembrado
tiene 3 evaluaciones para que el mentor tenga con qué trabajar. Misma salvedad
de siempre: una sola máquina, así que son un piso.

| Escenario                 | Carga       | Resultado                                                                |
| ------------------------- | ----------- | ------------------------------------------------------------------------ |
| `baseline` (sesión mixta) | 10/s, 1 min | 0 errores; listar vacantes p95 11 ms, entregar p95 39 ms                 |
| `mentor`, 40 % preguntas  | 10/s, 1 min | 0 errores; resumen p95 17 ms; pregunta p95 820 ms (800 ms son del doble) |
| `registro-empresa`        | 3/s, 1 min  | 0 errores; p95 45 ms                                                     |
| `registro-empresa`        | 25/s, 30 s  | 0 errores; p95 24 ms                                                     |

### El hallazgo: el mentor podía tumbar al resto del backend

Una pregunta al mentor **espera al modelo** y, mientras espera, ocupa un cupo del
control de admisión (50 en vuelo para todo el backend). Con 150 preguntas por
segundo, el escenario `baseline` corriendo a la vez recibió **503 en el 55 % de
sus peticiones** —listar vacantes, ver resultados—, aunque nada de eso tiene que
ver con el mentor.

**Arreglo:** un tope propio de preguntas al mentor esperando a la vez
(`MENTOR_MAXIMO_EN_VUELO`, 10 por omisión). La que pasa el tope se rechaza en
milisegundos con 429 y no toca la IA. Repetida la misma mezcla: el tráfico normal
quedó en **0 % de errores** (p95 8 ms) y el mentor rechazó el 46 % de lo que
sobraba, que es el comportamiento buscado.

**Qué significa el tope para el producto.** Con la latencia del doble, 10 en vuelo
son unas 12 preguntas por segundo en todo el proceso. Con Gemini real (varios
segundos por respuesta) serán pocas: **la cifra a revisar cuando haya usuarios
reales es el 429 del mentor**, y subirlo es cambiar una variable, no código. No se
midió con el modelo real.

### Lo que NO se midió

- El `stress` completo (hasta 400/s) no se repitió con estos cambios.
- Los 40 ms de `registro-empresa` indican que el costo de argon2id en este equipo
  es bajo; en la máquina de producción puede ser otro y el endpoint es público.
  Su límite por IP (el de login, 10 por minuto) es lo que lo protege de verdad,
  y se subió para medir.
