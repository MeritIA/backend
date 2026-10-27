# 0005 · PASETO v4 público en vez de JWT

**Estado:** vigente

## Contexto

Hacen falta tokens de sesión para dos clientes (web con cookies, APK con
cabecera). El Plan de Seguridad v1.0 exige que la autorización no se pueda
falsificar.

## Decisión

**PASETO v4 público** (`paseto` 3.1.4), firma Ed25519: el backend firma con la
clave privada y cualquier componente verifica con la pública.

## Alternativas descartadas

**JWT.** Es el estándar de hecho y tiene más tutoriales, y ahí está el problema:
su flexibilidad es la fuente de sus vulnerabilidades conocidas. `alg: none`, la
confusión entre HMAC y RSA, y tener que validar a mano que el algoritmo recibido
es el esperado. Todas se evitan con disciplina, y todas se han escapado en
producción en proyectos con más gente que este. PASETO no tiene un campo de
algoritmo que negociar: la versión fija la primitiva.

**Sesiones en servidor.** Obligan a un almacén compartido y a consultarlo en cada
petición. Se descartan porque el token tiene que valer igual para la web y para
la APK, y porque la revocación ya está resuelta de otra forma: cada usuario tiene
un `tokens_validos_desde`, así que cerrar sesiones es mover una fecha.

## Consecuencias

A favor: no hay confusión de algoritmo posible. La verificación no toca la base.

En contra: PASETO es menos conocido, hay menos ejemplos y menos bibliotecas; si
mañana entra un proveedor de identidad externo, hablará JWT y habrá que traducir
en la frontera. Y la clave privada es un secreto que hay que rotar: el día que se
filtre se cambia la pareja y todas las sesiones caen de golpe.
