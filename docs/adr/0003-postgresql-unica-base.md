# 0003 · PostgreSQL como única base de datos

**Estado:** vigente

## Contexto

El producto guarda datos relacionales (empresas, vacantes, usuarios), documentos
de forma variable (la respuesta de la IA con su desglose por criterio) y
necesita colas. Tres necesidades que suelen justificar tres tecnologías.

## Decisión

PostgreSQL para todo lo persistente, con `jsonb` donde la forma varía. Redis
solo para la cola y el rate limiting, que no son persistencia: si Redis se
vacía, no se pierde ninguna nota ya emitida.

## Alternativas descartadas

**MongoDB para las evaluaciones.** La respuesta de la IA tiene forma variable y
encajaría. Se descarta porque la evaluación es exactamente el dato que hay que
poder **disputar**: un candidato puede pedir que se revise su nota, y eso exige
transacciones y una relación fiable con la entrega, la versión de rúbrica y la
vacante. Dos motores para tres personas también son dos juegos de copias de
seguridad y dos modelos de permisos.

**Una segunda base para analítica.** No hay volumen que lo justifique: el ranking
de una vacante son decenas de filas (ADR 0010).

## Consecuencias

A favor: una transacción abarca todo lo que debe ser atómico. Un solo motor que
operar, respaldar y asegurar. `jsonb` cubre la forma variable sin renunciar a
`JOIN`.

En contra: PostgreSQL no es la herramienta ideal para analítica sobre millones de
evaluaciones. El día que la haya, la salida es una proyección aparte alimentada
por el evento que el paquete 4.5 ya publica, no cambiar de motor.
