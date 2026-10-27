# 0001 · Monolito modular de seis módulos, no microservicios

**Estado:** vigente · **Origen:** paquete 1.4, sostenida desde entonces

## Contexto

MeritIA tiene seis capacidades que el Diccionario de la EDT nombra por separado:
identidad, vacantes, banco de ejercicios, entregas, evaluación con IA y
reportes. El equipo son tres personas, sin plataforma de despliegue propia.

## Decisión

Un solo proceso desplegable, partido en seis módulos con **fronteras
verificadas por herramienta**: cada módulo expone su interfaz pública en un
`index.ts`, y ESLint falla si otro módulo importa algo que no esté ahí.

## Alternativas descartadas

**Microservicios.** Seis servicios para tres personas son seis despliegues, seis
juegos de credenciales y, sobre todo, que la primera consulta que cruce dos
servicios —el ranking cruza cuatro— pase a ser una llamada de red que puede
fallar sola. Habría que escribir reintentos y compensaciones para un producto
que todavía no tiene usuarios: el coste se paga el primer día y el beneficio
llegaría con una escala que no existe.

**Monolito sin módulos.** Es lo que pasa por omisión, y por eso hay que decidir
en contra: sin frontera declarada, en tres meses reportes consulta la tabla de
usuarios directamente y el día que haga falta partir algo ya no se puede.

## Consecuencias

A favor: una consulta que cruza módulos es una llamada de función y no una de
red, así que no hay fallo parcial que compensar. Un despliegue, un juego de
credenciales. Las fronteras ya están donde habría que cortar.

En contra, y es real: **todo escala junto**. `k6` lo midió: el proceso usa como
máximo el 128 % de un núcleo en una máquina de ocho, así que la primera
respuesta al crecimiento no es partir nada, es correr varias copias detrás de un
balanceador (ADR 0011 y `../evolucion-tecnologica.md`). Y la frontera depende de
que nadie desactive la regla de ESLint: es disciplina con red, no imposibilidad
física como la daría un proceso aparte.
