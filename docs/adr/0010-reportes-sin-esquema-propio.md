# 0010 · Reportes compone en vivo y no guarda una copia

**Estado:** vigente, con disparador de revisión

## Contexto

El Diccionario de la EDT lista «esquema de reportes» entre los recursos del
paquete 5.1. Lo normal en analítica es proyectar: copiar las notas a tablas con
la forma del informe.

## Decisión

El módulo de reportes **no tiene tablas de datos propias**: compone en cada
consulta lo que ya existe en evaluación, entregas, vacantes y autenticación, cada
uno por su puerta pública. Es una **divergencia con el documento**, y queda dicha
en voz alta aquí y en la Declaración de Alcance (D-3) en vez de resuelta en
silencio.

La única tabla que reportes sí tiene es el registro de **revelaciones de
identidad**, y no contradice lo anterior: es un dato nuevo que no existe en
ningún otro módulo, así que no puede desincronizarse de nada.

## Alternativas descartadas

**Proyección materializada.** Una copia de las notas se desincroniza —un evento
perdido, un reinicio a medias— y entonces el informe contradice a la evaluación.
Y la evaluación es el dato que un candidato puede disputar: si los dos números no
coinciden, el que vale es el de la evaluación, y el informe solo sirve para
perder la discusión.

## Consecuencias

A favor: el informe nunca miente respecto a la nota. No hay sincronización que
vigilar.

En contra: cada consulta recalcula. Hoy no importa —el ranking de una vacante son
decenas de filas, y `k6` lo midió dentro de objetivo—, pero no escala a analítica
sobre millones.

**Disparador de revisión:** si el informe de una vacante pasa de ~500 ms en p95,
o si entra la analítica avanzada que la Declaración excluye del MVP, el paso
natural es proyectar desde el evento `evaluacion.evaluacion-finalizada`, que el
paquete 4.5 ya publica justo para esto. No hace falta rediseñar nada: hace falta
escuchar un evento que ya existe.
