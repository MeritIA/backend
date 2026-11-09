# ADR-0016 · El % de afinidad sale de rúbricas calificadas, y ordena sin esconder

**Fecha:** 2026-11-02
**Estado:** aceptada
**Contexto:** §6.2 de `matriz-pantallas.md`, decisión **D-20**. Completa lo que el [ADR-0015](0015-postulacion-sin-motor-de-afinidad.md) dejó sin construir.

## Lo que había

El ADR-0015 abrió el catálogo y dejó el motor de afinidad **sin construir**, con
una razón: un % de encaje necesita un perfil de habilidades, y «hoy los
criterios viven dentro de cada ejercicio».

**Esa razón era medio cierta, y el medio equivocado importa.** Los *criterios*
viven dentro de cada ejercicio, sí. Pero las **calificaciones** no:
`evaluacion.calificaciones_criterio` guarda una fila por criterio con su
puntaje, su escala y su peso, para cada entrega evaluada. Agrupando por nombre
de criterio sale un perfil transversal **sin inventar ninguna taxonomía**.

Así que el dato existía. Lo que no existía era la consulta.

## Qué compara

| | |
|---|---|
| Lo que la vacante **exige** | Los criterios de las rúbricas de sus ejercicios, con sus pesos |
| Lo que el candidato ha **demostrado** | Su nivel medio en cada criterio sobre el que alguna vez se le calificó |

**No compara un CV con una descripción de puesto, y eso es lo que lo hace
coherente con el producto.** La afinidad de MeritIA sale de pruebas resueltas y
calificadas contra una rúbrica, no de lo que alguien escribió sobre sí mismo. Es
la única versión de «afinidad» que no reintroduce el cribado que MeritIA existe
para quitar.

## Las cuatro decisiones del cálculo

### 1. Sin evidencia es `null`, no cero

Un candidato que no ha hecho ninguna prueba **no tiene un 0 % de afinidad**:
tiene afinidad desconocida. Un cero diría «no encajas» a quien todavía no ha
tenido oportunidad de demostrar nada, que es lo contrario de lo que el producto
quiere decir.

Es la misma distinción que ya existe en el panel de la empresa entre
`avance === null` («no has invitado a nadie») y `avance === 0` («invitaste y
nadie avanzó»).

### 2. La media se pondera solo sobre lo que tiene evidencia

Si un criterio de la rúbrica nunca se le calificó, **no cuenta como cero**:
cuenta como que no se sabe. Lo contrario confundiría «lo hace mal» con «nunca se
le preguntó», y la segunda no es culpa de nadie.

**El precio:** un candidato con evidencia en un solo criterio de cuatro puede
salir con un 90 %. Por eso el número **nunca viaja solo**.

### 3. Siempre va con `cobertura`

Dice sobre cuánto peso de la rúbrica hay evidencia. Un **90 % con cobertura del
25 %** se lee distinto que un 90 % con cobertura del 100 %, y la pantalla tiene
los dos números para poder decirlo.

Es lo que impide que el número engañe sin tener que mentir sobre él.

### 4. Y con el desglose por criterio

Qué se pedía, cuánto pesaba, qué nivel se demostró y cuántas calificaciones lo
sostienen. **Para que el número se pueda discutir en vez de creer** — la misma
razón por la que cada criterio de una calificación lleva evidencia obligatoria.

## La decisión que más importa: ordena, nunca esconde

`GET /reportes/afinidad` devuelve el **catálogo completo**, incluidas las ofertas
con afinidad `null`.

**Un algoritmo que decide qué ofertas ve una persona es exactamente el sesgo que
la auditoría de equidad del paso 11 existe para vigilar.** Un número que informa
y se puede discutir no lo es. La diferencia entre las dos cosas es si el
candidato puede ver —y pedir— lo que el algoritmo puntuó bajo.

Hay una prueba de integración que lo fija: una oferta sin nada en común con el
perfil **sigue estando en la respuesta**.

Y **quien no tiene evidencia sale al principio, no al final**: es quien más
necesita encontrar su primera prueba, y hundirlo sería castigarle por no haber
empezado.

## Dónde vive, y por qué no hubo elección

En **`reportes`**. No es gusto arquitectónico: la afinidad necesita datos de
`evaluacion`, y `evaluacion` ya depende de `vacantes`. Calcularla dentro de
`catalogoAbierto` crearía un **ciclo entre módulos**.

Reportes es el módulo que compone entre módulos sin ser dueño de nada
([ADR-0010](0010-reportes-sin-esquema-propio.md)), y le pide el catálogo a
`vacantes` en vez de reescribirlo: una sola definición de «oferta abierta».

El perfil se lee **una vez** y se compara contra todas las ofertas, como el panel
de A02: pedir la afinidad oferta por oferta serían veinte consultas para pintar
una lista.

## El límite conocido, dicho antes de que lo descubra una demostración

**No hay vocabulario de habilidades.** `criterios_rubrica.nombre` es texto libre
de 120 caracteres. Se normaliza lo único que se puede normalizar sin inventar:
mayúsculas, acentos y espacios de sobra. Así «Corrección funcional» y
«correccion funcional» son la misma habilidad, que es lo que dos reclutadores
escribiendo lo mismo producen en la práctica.

**Pero no hay sinónimos, ni raíces, ni nada semántico.** «Claridad del código» y
«Legibilidad» son **dos habilidades distintas** para este código, aunque una
persona las juntaría. Hay una prueba que fija ese límite, para que esté escrito
en vez de descubrirse con un número raro delante del profesor.

La consecuencia práctica: **la afinidad funciona bien cuando las empresas
reutilizan ejercicios del banco** —mismo nombre de criterio, mismo significado—
y se degrada cuando cada una inventa sus propios nombres. Eso empuja hacia el
banco reutilizable, que es lo que A10 quiere de todas formas.

Resolverlo es un vocabulario cerrado de habilidades: una decisión de producto
con su mantenimiento, no una función de texto.

## Un supuesto que no es un dato

Una vacante con tres ejercicios: los pesos de **una** rúbrica suman 100, así que
tres sumarían 300. Se reparten **a partes iguales entre ejercicios**.

No por número de criterios: un ejercicio con ocho criterios no es más importante
que uno con dos, es más detallado, y repartir por criterios haría que detallar
una rúbrica le diera más peso sin que nadie lo decidiera. Hay una prueba de eso.

**La vacante no dice cuánto vale cada ejercicio —no hay campo para eso— así que
valen lo mismo.** Es un supuesto, y queda escrito como lo que es. Si el equipo
quiere ponderar ejercicios, es una columna y este cálculo la respeta.

## Lo que esto no es

- **No es preselección.** A04 promete que «MeritIA preselecciona por perfil de
  habilidades e **invita solo a los finalistas**». Esto calcula el número y lo
  muestra; **nadie se invita automáticamente**. Pasar de informar a invitar es
  una decisión de producto, y es la que el ADR-0015 dejó abierta.
- **No es un perfil que la empresa vea.** `GET /reportes/mi-perfil-de-habilidades`
  es solo para uno mismo. Lo que una empresa ve de un candidato es su desglose en
  **su** vacante, no lo que demostró en las de la competencia.
- **No es predicción.** Mide lo que ya pasó. Que alguien tenga 90 % en una
  habilidad no dice que le vaya a ir bien: dice que le fue bien antes.

## Alternativa descartada: afinidad declarada por el candidato

Que el candidato marque sus habilidades y se comparen con las de la vacante. Es
más fácil y da cobertura del 100 % desde el primer día.

Se descartó porque **es un CV con otro nombre**: nadie lo verifica, premia a
quien se describe mejor, y es justo el sesgo que el producto existe para quitar.
La afinidad tarda en tener datos, y eso es el precio de que signifique algo.
