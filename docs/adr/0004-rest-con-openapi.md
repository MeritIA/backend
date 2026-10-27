# 0004 · REST con contrato OpenAPI, no GraphQL

**Estado:** vigente

## Contexto

Dos clientes van a consumir esta API: una web y una APK. Los escribe gente
distinta de quien escribe el backend, y el frontend arrancó después.

## Decisión

REST versionado (`/api/v1`) con el contrato OpenAPI **generado desde el código y
versionado en el repositorio** (`docs/openapi.json`, 43 operaciones). Cada
cambio de API deja su diferencia visible en el commit.

## Alternativas descartadas

**GraphQL.** Resuelve bien que un cliente elija campos, y ese problema aquí es
pequeño: las pantallas están dibujadas y se sabe qué pide cada una. A cambio
traería el suyo: la autorización se reparte por cada resolver, y es mucho más
fácil dejar un campo expuesto sin darse cuenta. En un producto cuyo riesgo
principal es que alguien vea datos de otra empresa, ese es un mal canje. Además
el límite de profundidad y el coste de consulta serían trabajo extra desde el
primer día.

**gRPC.** Pensado para servicio a servicio, no para un navegador.

## Consecuencias

A favor: el contrato es un archivo que el frontend lee y contra el que genera
tipos sin preguntar. La autorización vive en un sitio por ruta. Cualquier `curl`
sirve para depurar.

En contra: una pantalla que necesita cuatro cosas hace cuatro llamadas. Cuando
eso pesa de verdad se resuelve con un endpoint que compone —el panel de la
pantalla A02 es exactamente eso—, no cambiando de protocolo.
