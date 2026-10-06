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
   sección 11 lo pide así: un *soak* contra Gemini cuesta dinero y choca con su
   *rate limit*. El doble simula la latencia del proveedor, **no su cómputo**.

Y una regla de conducta que la propia sección 11 impone: *no afirmar que el
sistema es rápido sin datos*. Lo que sigue son datos; lo que no se midió, se
dice.

## 1. Carga normal

10 iteraciones/s durante 2 minutos. **3.046 peticiones, 25,4 pet/s, cero
errores.**

| Operación | p50 | p95 | p99 |
|---|---|---|---|
| Listar vacantes | 7,1 ms | 15,2 ms | 33,4 ms |
| Mis entregas | 5,8 ms | 13,6 ms | 22,1 ms |
| Mis evaluaciones | 7,0 ms | 12,6 ms | 19,3 ms |
| Evaluaciones de la vacante | 12,5 ms | 28,3 ms | 40,7 ms |
| Reporte consolidado | 15,9 ms | 31,9 ms | 63,6 ms |
| Entregar archivo | 33,9 ms | 68,8 ms | 273,9 ms |

El reporte del paquete 5.1 compone cuatro módulos en cada consulta y se queda
en **64 ms de p99**. Era la duda principal al decidir que ese módulo no tuviera
esquema propio; con este dato, la decisión se sostiene.

## 2. Dónde cae: barrido escalón por escalón

Cada ritmo en una corrida aparte, 45 s, sobre base recién creada. Los criterios
se fijaron **antes** de medir, para no acomodarlos al resultado:

- **SANO** — p95 < 500 ms, cero iteraciones descartadas, cero errores.
- **DEGRADADO** — p95 < 2 s y menos del 5 % descartadas.
- **CAÍDO** — p95 ≥ 2 s, o ≥ 5 % descartadas, o > 1 % de errores inesperados.

| it/s | pet/s | p50 | p95 | p99 | Reporte p95 | Entregar p95 | Descartadas | Estado |
|---|---|---|---|---|---|---|---|---|
| 10 | 27 | 6 ms | 21 ms | 35 ms | 33 ms | 36 ms | 0 % | **SANO** |
| 20 | 53 | 7 ms | 25 ms | 71 ms | 62 ms | 36 ms | 0 % | **SANO** |
| 30 | 79 | 9 ms | 83 ms | 190 ms | 242 ms | 148 ms | 0 % | **SANO** |
| 40 | 106 | 14 ms | 1.176 ms | 2.011 ms | 2.137 ms | 1.781 ms | 0,1 % | DEGRADADO |
| 50 | 78 | 331 ms | 2.881 ms | 4.187 ms | 4.101 ms | 5.396 ms | 4,7 % | **CAÍDO** |
| 60 | 131 | 3.475 ms | 6.559 ms | 9.477 ms | 8.070 ms | 10.991 ms | 15,8 % | CAÍDO |

**Capacidad sana: 30 it/s ≈ 79 pet/s. Punto de caída: 50 it/s.**

### Cae por latencia, nunca por error

En **ningún** escenario hubo una sola respuesta inesperada. Bajo saturación el
sistema no se equivoca: se vuelve inusable. Listar vacantes pasó de 7 ms a
3,5 s de mediana. Eso es una buena noticia sobre la corrección y una mala sobre
la operación.

### El hallazgo que manda en el plan: colapso por congestión

El rendimiento máximo está en el codo —**106 pet/s**— y a partir de ahí
**baja**: 78, y en el *stress* hasta 57 pet/s. Con más carga, el sistema hace
**menos** trabajo. No se degrada de forma elegante: se ahoga y empeora solo.

| Escenario | Pedido | Logrado | Descartadas | p95 |
|---|---|---|---|---|
| Stress | 400 it/s | 47,5 it/s (124 pet/s) | 15.146 | 6,18 s |
| Spike | 250 it/s de golpe | 31,2 it/s (84 pet/s) | 6.616 | 5,82 s |

## 3. El estado acumulado pesa, y no se sabe cuánto

El mismo ritmo de 20 it/s dio **25 ms de p95 sobre base nueva** y **541 ms
sobre base usada** (unas 1.100 entregas y evaluaciones, más el worker
procesando atrasos). **Veintiún veces, con la misma carga.**

Hay dos causas plausibles y **no se ha determinado cuál manda**: las filas
acumuladas encareciendo el reporte, o el worker de la cola compitiendo por el
*event loop*. Queda como medición pendiente (P5), no como conclusión.

## 4. Quién es el cuello de botella

| Recurso | Máximo | Veredicto |
|---|---|---|
| Conexiones a PostgreSQL | **11 de 100** | No es el pool |
| CPU de PostgreSQL | 110 % | Trabaja, no se ahoga |
| CPU de Redis | 14 % | Irrelevante |
| CPU del almacenamiento | 17 % | Irrelevante |
| **CPU del proceso de Node** | **128 %, promedio 66 %** | **Aquí está** |
| Memoria del backend | 200 → 628 MB | Sin conclusión |

La máquina tiene **8 núcleos** y en el punto de caída el sistema entero usa
**~1,3**. El backend es un proceso de Node: un hilo, un núcleo. Siete están
mirando.

**No hay una consulta lenta que optimizar. Hay siete núcleos sin usar.**

## 5. Requisitos no funcionales, derivados de lo medido

Antes no existían: no hay documento que fije objetivos de rendimiento para
MeritIA. Estos salen de las cifras de arriba, que es el único modo honesto de
escribirlos. **Se cumplen o no según la medición, y se dice cuál es cuál.**

| | Requisito | Estado |
|---|---|---|
| **RNF-1** | Sostener **≥ 75 pet/s** (30 it/s) en una instancia, con 8 núcleos compartidos | ✅ medido: 79 pet/s |
| **RNF-2** | p95 en capacidad sana: lecturas simples ≤ 100 ms, reporte consolidado ≤ 250 ms, entrega de archivo ≤ 300 ms | ✅ medido: 83 / 242 / 148 ms |
| **RNF-3** | **Cero respuestas inesperadas** hasta el punto de caída | ✅ medido: 0 en todos los escenarios |
| **RNF-4** | Pasado el punto de caída, rechazar explícitamente (**503 + `Retry-After`**) y mantener el rendimiento del pico | ❌ **no se cumple**: hoy colapsa a 57 pet/s |
| **RNF-5** | Tras un pico, volver al p95 de capacidad sana en ≤ 60 s | ⚠️ **no medible todavía**: falta serie de tiempo |
| **RNF-6** | Sin crecimiento sostenido de memoria bajo carga constante | ⚠️ **no verificado**: falta un *soak* de horas |

Tres cumplidos con número, uno incumplido, dos sin poder afirmar nada. El
incumplido es el P1 del plan.

## 6. Plan de mejora

Ordenado por evidencia y retorno.

### P1 — Control de admisión

**Evidencia:** pasado el codo el rendimiento baja (106 → 78 → 57 pet/s).

**Acción:** limitar peticiones en vuelo y responder **503 con `Retry-After`** al
pasar el umbral. No sustituye al *rate limiting*: ese protege de abuso por
origen, esto protege al proceso de sí mismo.

**Efecto esperado:** el rendimiento se mantiene plano en el pico en vez de
derrumbarse; el exceso recibe una respuesta clara y rápida.

**Verificación:** repetir el barrido. Criterio: `pet/s` **no cae** tras el codo.

**Va primero** porque es lo único que cambia el comportamiento bajo abuso, es
barato, y arregla el peor caso en vez del promedio.

### P2 — Usar los otros siete núcleos

**Evidencia:** 8 núcleos, ~1,3 en uso, Node de un solo hilo.

**Acción:** varias instancias detrás de un balanceador. La aplicación ya es
apta: PASETO sin estado, *rate limiting* en Redis, cola en BullMQ.

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

### P6 — Un *soak* de verdad

Horas, no diez minutos, mirando la pendiente. Hoy **no se puede afirmar** si hay
fuga o si es el *heap* de V8 que no devuelve memoria al sistema operativo.

## 7. Lo que NO hay que hacer todavía

Tocar consultas, añadir caché, subir el pool o afinar PostgreSQL. La evidencia
dice que **ninguno es el cuello**: 11 conexiones de 100, Redis al 14 %,
almacenamiento al 17 %. Hacerlo ahora sería optimizar sin evidencia, que es lo
que la sección 9 prohíbe.

## 8. Deuda del método de medición

1. El resumen agregado del *spike* **no puede decir si recuperó** tras el pico,
   que es justo para lo que ese escenario existe. Necesita series de tiempo.
2. **Resembrar antes del escenario de entregas**: el barrido se come el techo de
   intentos y deja ese escenario midiendo 409s. Pasó dos veces.
3. Medir en una máquina donde el generador de carga no compita por los mismos
   núcleos.
