# 0007 · La evaluación con IA va por cola, no en la petición

**Estado:** vigente

## Contexto

Calificar una entrega implica llamar a un modelo de lenguaje: segundos en el
mejor caso, un minuto cuando el proveedor va lento, y un error que no depende de
nosotros cuando se cae o cuando se agota la cuota.

## Decisión

El candidato entrega y recibe respuesta inmediata; la evaluación se encola en
**BullMQ** (6.3.5, sobre Redis) con reintentos de espera exponencial. El
identificador del trabajo **es el de la entrega**, así que encolar dos veces la
misma entrega no la evalúa dos veces. Un interruptor
(`COLA_WORKER_HABILITADO`) decide si ese proceso consume la cola, para poder
separar mañana la web del trabajador sin tocar código.

## Alternativas descartadas

**Evaluar dentro de la petición.** El candidato esperaría frente a una barra de
progreso un minuto, y un fallo del proveedor se convertiría en «tu entrega
falló» cuando la entrega está perfectamente guardada. Peor: el `timeout` del
proxy decidiría si su trabajo cuenta.

**Una tabla de pendientes recorrida por un cron.** Es una cola peor: hay que
escribir el bloqueo entre trabajadores, el reintento y la espera. Si el estado de
la entrega ya vive en PostgreSQL, lo que falta es exactamente lo que BullMQ ya
trae.

## Consecuencias

A favor: una caída del proveedor de IA retrasa notas, no rechaza entregas —y por
eso el servicio de IA **no** es dependencia crítica del health check (D-2)—. La
cuota se limita en un sitio. El trabajador se escala aparte del web.

En contra: aparece una pieza de infraestructura más (Redis) y un estado nuevo que
el producto tiene que mostrar: «en evaluación». La pantalla B19 existe por esta
decisión. Y una cola que crece es un problema que hay que vigilar, de ahí
`GET /evaluaciones/cola`.
