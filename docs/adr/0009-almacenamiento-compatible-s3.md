# 0009 · Almacenamiento compatible con S3, y SeaweedFS en desarrollo

**Estado:** vigente

## Contexto

Las entregas son archivos de hasta 25 MiB. Guardarlos en PostgreSQL haría que
cada copia de seguridad de la base arrastrara gigabytes de `.zip`.

## Decisión

Objetos en un almacén compatible con S3, hablado con `@aws-sdk/client-s3` y
`forcePathStyle`, y **URL firmadas** para subir y bajar: el archivo no pasa por
el proceso de Node. Al arrancar se comprueba que el bucket existe, que **no es
público** y que tiene política de retención.

En desarrollo el almacén es **SeaweedFS**, no MinIO.

## Alternativas descartadas

**Los archivos en la base de datos.** Convierte el respaldo de la base en el
respaldo de los archivos, y cada restauración en horas.

**El disco del contenedor.** No sobrevive a un reinicio y no se comparte entre
dos copias del proceso.

**MinIO, que era la elección inicial.** Retiró sus imágenes públicas de Docker
Hub el 11/09/2026 y su registro alternativo pide cuenta, así que el entorno de
desarrollo dejó de levantarse —y la CI llevaba semanas en rojo por eso—. El
reemplazo se eligió **midiendo con las pruebas de almacenamiento del propio
proyecto**: `adobe/s3mock` quedó fuera porque no valida firmas (una prueba de
seguridad que pasa sin comprobar nada es peor que no tenerla), `localstack` pasó
11 de 14, `zenko/cloudserver` las 14 pero con una imagen de 2022, y **SeaweedFS**
las 14 con una versión de hace un mes.

## Consecuencias

A favor: subir y bajar no consume memoria ni hilos del backend. En producción se
puede usar S3 real sin cambiar código.

En contra: una URL firmada que se filtra es acceso temporal al archivo, así que su
vida tiene que ser corta. Y la paridad entre almacenes compatibles no es
perfecta: que las 14 pruebas pasen en SeaweedFS no garantiza que un detalle de S3
real se comporte igual. Por eso las pruebas corren contra el almacén y no contra
un doble.
