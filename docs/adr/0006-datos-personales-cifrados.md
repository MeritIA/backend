# 0006 · Datos personales cifrados en reposo, con hash para poder buscar

**Estado:** vigente

## Contexto

La Ley 1581 de 2012 obliga a proteger los datos personales que el producto
maneja: nombre y correo de los candidatos, y el nombre del archivo que entregan
—que a menudo es `cv-juan-perez.pdf`—. Pero el correo también es la credencial
de entrada, así que hay que poder **encontrar** una fila por correo.

## Decisión

Tres mecanismos para tres problemas distintos:

- **Contraseñas:** `argon2id` (`m=19456, t=2, p=1`). No se descifran nunca.
- **Datos personales** (correo, nombre, nombre de archivo): **AES-256-GCM** en un
  transformador de columna, así que se cifran y descifran al borde del ORM y
  ningún servicio ve texto cifrado.
- **Búsqueda por correo:** una columna aparte, `correo_hash`, con SHA-256 del
  correo normalizado, y el índice único va sobre ella.

## Alternativas descartadas

**Cifrar y buscar descifrando.** Obligaría a traer toda la tabla de usuarios para
encontrar un correo. Imposible en el inicio de sesión.

**Guardar el correo en claro «porque no es tan sensible».** En un producto cuyo
argumento es que el candidato no sea juzgado por quién es, la lista de quién se
postuló a qué es justo el dato que no debe poder leerse de un volcado.

**Cifrado de disco.** No protege de un `SELECT`, que es la fuga realista.

## Consecuencias

A favor: un volcado de la base no entrega correos ni nombres. El inicio de sesión
sigue siendo una búsqueda por índice.

En contra: **no se puede buscar por nombre parcial** ni ordenar por correo en
SQL, porque el valor almacenado es opaco. Y aparece la pregunta de rotar la clave
de cifrado, que hoy **no está resuelta**: cambiarla exige reescribir las columnas
cifradas. Queda anotado como deuda, no como resuelto.
