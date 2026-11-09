# ADR-0017 · Vocabulario de habilidades, e invitación que solo dice sí

**Fecha:** 2026-11-02
**Estado:** aceptada
**Contexto:** cierra los dos pendientes del [ADR-0016](0016-afinidad-desde-rubricas-calificadas.md) y lo que faltaba de A04. Decisiones **D-21** y **D-22**.

## Parte 1 · El vocabulario de habilidades (D-21)

### El problema que cierra

El ADR-0016 dejó escrito su límite: `criterios_rubrica.nombre` es texto libre,
así que **«Claridad del código» y «Legibilidad» eran dos habilidades distintas**
para el cálculo de afinidad, aunque una persona las juntaría.

### Una tabla, no un enum — al contrario que el sector de una empresa

`SectorEmpresa` es un enum porque los sectores **se pueden enumerar de
antemano**: hay catorce y se reconocen de un vistazo.

Las habilidades no. Cada reclutador escribe los criterios de **su** rúbrica, y el
vocabulario tiene que poder crecer con lo que las empresas escriben de verdad,
sin un despliegue y sin un `ALTER TYPE`. Un enum obligaría a adivinar hoy la
lista completa de habilidades técnicas que existirán, y eso no se puede.

### Dos tablas, no una columna de sinónimos

La regla que sostiene todo es que **un término pertenezca a una sola habilidad**.
Con un `text[]` dentro de `habilidades` no se puede imponer: si «claridad» fuera
alias de dos, resolverlo sería elegir al azar y el mismo criterio contaría
distinto en cada recálculo. Con tabla propia, **el índice único lo impone la
base**.

Lo que la base **no** puede imponer —porque son dos tablas— es que un alias no
sea el nombre canónico de otra habilidad. Eso lo comprueba el servicio, y queda
dicho en la migración para que nadie suponga que está cubierto.

### Es de plataforma, y ese es el punto

Si cada empresa tuviera su vocabulario, dos empresas que piden lo mismo seguirían
midiendo habilidades distintas y **el perfil del candidato dejaría de ser
transversal**, que es justo lo que lo hace valer.

**El coste, dicho:** es un cuello de botella humano. Un administrador tiene que
mantenerlo, y mientras no lo haga la afinidad acierta menos.

### Degrada, no rompe

Un nombre que no está en el catálogo resuelve a su propia forma normalizada —
exactamente lo que hacía antes de que el vocabulario existiera. Así **el catálogo
se puede empezar vacío y llenar poco a poco**, y nada deja de funcionar mientras
está a medias. Es la propiedad que permite desplegar esto sin migrar datos.

### Editar el vocabulario mueve todas las afinidades

Y es lo que se quiere: unir dos nombres es un arreglo, y las afinidades **se
calculan en vivo, sin copia guardada** ([ADR-0010](0010-reportes-sin-esquema-propio.md)),
así que el arreglo se aplica solo.

Con una excepción deliberada: **las invitaciones automáticas ya emitidas guardan
la afinidad con la que se decidieron** (`afinidad_al_decidir`). Sin eso sería
imposible reconstruir por qué la máquina invitó a alguien, una vez el vocabulario
cambió. Mismo criterio que `id_version` en una evaluación: se guarda contra qué
se decidió, no solo el resultado.

### El límite que queda

No hay nada semántico: los sinónimos hay que **registrarlos a mano**. Nadie
descubre que «Testing» y «Pruebas automatizadas» son lo mismo si no se lo dicen.
La alternativa —comparar con el modelo de lenguaje— se descartó: haría el perfil
**no determinista**, y un perfil que cambia entre dos consultas no se puede
discutir con un candidato.

Esto empuja hacia que las empresas **reutilicen ejercicios del banco**, que es lo
que A10 quiere de todas formas.

---

## Parte 2 · La invitación automática (D-22)

A04 promete que «MeritIA preselecciona por perfil de habilidades e **invita solo
a los finalistas**». Esto es esa promesa. Y es la función más peligrosa del
producto, así que lleva tres reglas que la hacen defendible.

### Regla 1 · Solo dice sí, nunca no

**Es la regla que lo hace seguro. Si se quita, hay que rehacer este análisis
entero.**

La automatización únicamente **acepta**. A quien no alcanza el umbral lo deja
`en_revision`: exactamente donde estaría si la función no existiera, esperando a
una persona. Así **la función no puede perjudicar a nadie — solo puede
adelantar**.

Un rechazo automático sería otra cosa: un algoritmo cerrando la puerta sin que
nadie mire. Y además el producto exige un **motivo escrito** para rechazar, el
que el candidato lee, y una máquina no puede escribirlo con honestidad.

Hay una prueba que recorre los cinco desenlaces negativos posibles y comprueba
que **ninguno significa rechazar**.

### Regla 2 · Sin evidencia se abstiene, y eso salva a quien empieza

Si la afinidad es `null` —el candidato no ha hecho ninguna prueba que toque lo
que esta vacante pide— la automatización no decide.

Lo contrario sería **la trampa del principiante**: sin perfil no entras, sin
entrar no haces pruebas, sin pruebas no tienes perfil. Un bucle cerrado que
excluiría para siempre a quien llega nuevo, que es justo a quien el producto dice
servir.

### Regla 3 · El cupo limita lo automático, no las invitaciones

`cupo` cuenta **solo** las invitaciones que emitió la máquina. El reclutador
sigue invitando a mano sin tope.

Era tentador reutilizar `finalistasAEvaluar`, pero **D-12 dice que ese número es
un plan y no un máximo**, y usarlo como tope la contradiría en silencio.

### Los dos modos, y por qué el abierto importa

| `umbral` | Qué hace |
|---|---|
| Un número | Entra quien lo alcanza. Quien no tiene evidencia queda para una persona |
| `null` | **Acepta a todo el que se postule**, hasta el cupo |

El modo abierto no es un descuido: es **la tesis del producto** —el reto es el
filtro— y es la recomendación que el [ADR-0015](0015-postulacion-sin-motor-de-afinidad.md)
dejó escrita. Es también el único modo **sin trampa del principiante**, porque no
mira el perfil.

### Síncrono, y no por el bus de eventos

El bus era lo obvio y está descartado por dos razones, las dos escritas en el
comentario del propio bus:

1. **Es asíncrono.** El candidato recibiría `en_revision` y la invitación
   llegaría después, así que su pantalla diría «esperando» cuando ya está dentro.
2. **Un suscriptor que falla se registra y ahí queda.** Si la invitación
   automática fallara, nadie se enteraría y el candidato esperaría para siempre
   una decisión que no va a llegar. **Un fallo que nadie ve es peor que un fallo
   que corta la petición.**

Así que la respuesta del `POST /postular` dice el **estado final**.

### El puerto, porque había un ciclo

La decisión ocurre en `vacantes`, pero la afinidad se calcula en `reportes`, que
necesita `evaluacion`, que ya depende de `vacantes`. Pedirla directamente sería
un ciclo.

`vacantes` declara **qué** necesita (`CalculadorDeAfinidad`) y `ReportesService`
se registra al arrancar — el mismo momento en que `notificaciones` se suscribe al
bus. **Si nadie se registra, la función no se puede encender:** devuelve 400
diciéndolo, en vez de inventar un porcentaje o saltarse el umbral.

### Encender la política procesa lo que ya estaba esperando

Si no, encenderla no haría nada visible hasta la siguiente postulación, y quien
llevara tres días esperando seguiría esperando. Es una pasada acotada —las
pendientes de **una** vacante— y va **en orden de llegada**: si hay cupo, lo justo
es que lo coja quien se postuló antes.

Lo ya decidido no se reabre: un rechazo con su motivo sigue siendo un rechazo.

### Quién responde

Una decisión automática guarda `decision_automatica = true` **y** el reclutador
de la vacante en `id_usuario_que_decidio`. Se pensó en dejar el usuario a `null`
para marcar lo automático y se descartó: **una política la enciende una persona,
y esa persona responde por lo que la máquina acepte.** Así no se pierde el
responsable.

## Lo que sigue sin existir de A04

**La invitación a quien no se postuló.** A04 se puede leer como que MeritIA
busca candidatos y los invita sin que ellos pidan nada. Esto invita a quien **se
postuló**; no sale a buscar en la base de datos de candidatos.

Eso sería un producto distinto —el banco de talento, que necesita el
consentimiento de perfil público de B12 y no tiene paquete en la EDT— y queda
fuera a propósito.
