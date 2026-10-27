# 0011 · Control de admisión en el middleware: 503 antes de ahogarse

**Estado:** vigente, **pendiente de re-medir**

## Contexto

La prueba de carga progresiva con `k6` encontró el punto de caída y, sobre todo,
encontró **cómo** cae:

| Carga | Resultado |
|---|---|
| 30 it/s | sana: 79 pet/s, p95 83 ms, cero respuestas inesperadas |
| en la rodilla | pico de **106 pet/s** |
| más carga | **78 pet/s**, y después **57** |

Con más carga el sistema atendía **menos**. Eso es colapso por congestión —todo
el mundo espera, nadie termina— y no se arregla optimizando una consulta: las
conexiones de base estaban en 11 de 100 y el proceso de Node en el 128 % de **un**
núcleo de ocho. No había una consulta lenta; había siete núcleos sin usar.

## Decisión

Un tope de peticiones en vuelo. Al pasarlo se responde **503 con `Retry-After`**
en vez de aceptar trabajo que no se va a poder terminar. El tope se dimensiona
con la ley de Little: trabajo en vuelo = caudal × latencia objetivo.

Va en un **middleware**, y eso es la decisión fina: en Nest el orden es
middleware → guardias → interceptores → pipes, así que es el único sitio donde se
puede rechazar **antes** de gastar validación, autenticación y una conexión a la
base en una petición que se va a descartar.

## Alternativas descartadas

**Subir el límite del rate limiting.** El rate limiting protege de un abusador;
esto protege del éxito. Son problemas distintos: aquí cada cliente se porta bien.

**Escalar la máquina.** No era el cuello: siete núcleos estaban libres.

**Escalar horizontalmente y no hacer nada más.** Correr varias copias es la
respuesta correcta al crecimiento (`../evolucion-tecnologica.md`), pero no
sustituye a esto: una copia saturada sigue colapsando, y con balanceador son
varias copias colapsando a la vez.

## Consecuencias

A favor: pasado el tope, el cliente recibe una respuesta clara y accionable en
milisegundos en vez de un `timeout` a los treinta segundos. El caudal deja de
caer cuando sube la carga.

En contra: hay un número en la configuración que depende de la máquina, y mal
puesto rechaza antes de hacer falta. Hay que medirlo por entorno.

**Lo que falta, y no está hecho:** volver a correr el barrido para confirmar que
el caudal ya no baja después de la rodilla. Hasta entonces el RNF-REN-4 queda
como *implementado sin verificar*, que no es lo mismo que cumplido.
