# ADR-0015 · Postularse, sin inventar un motor de afinidad

**Fecha:** 2026-11-02
**Estado:** aceptada
**Contexto:** contradicción §6.2 de `matriz-pantallas.md`, decisión **D-19**

## El problema

Hasta ahora un candidato **solo veía las vacantes a las que alguien lo invitó**.
No había forma de encontrar trabajo en MeritIA: había que esperar a que un
reclutador te escogiera de una lista que él ya tenía. Eso deja al producto sin
el lado del candidato.

Pero al abrirlo aparecen dos frases del propio diseño que no dicen lo mismo:

- **A04:** «MeritIA preselecciona por perfil de habilidades e **invita solo a
  los finalistas**.»
- **B13:** el candidato descubre vacantes por **% de afinidad**.

Las dos describen un motor que empareja personas con ofertas. Y las dos chocan
con lo que el backend hace hoy: **invita el reclutador, uno por uno**.

El BPM del equipo no resuelve la duda: su camino empieza con el candidato ya
dentro de una sesión que se analiza por fraude. Los pasos 1 y 2, que serían los
de entrada, son los que no se pudieron leer.

## Lo que se decidió

**Se cierra la mitad que se puede cerrar sin inventar nada, y la otra se deja
nombrada.**

1. **Catálogo abierto** (`GET /vacantes/abiertas`): el candidato ve las
   vacantes publicadas de empresas activas. Sin orden por afinidad, **sin
   puntuación de encaje**: ordenadas por fecha de publicación.
2. **Postularse** (`POST /vacantes/{id}/postular`): crea una solicitud
   `en_revision`. **No da acceso al reto.**
3. **El reclutador decide**: `aceptar` crea la invitación —que es lo que da
   acceso— y `rechazar` exige un motivo que el candidato lee.

## Por qué no se construyó el motor de afinidad

Porque **el dato que necesita no existe**. Un % de afinidad se calcula contra un
perfil de habilidades de la persona, y hoy los criterios viven **dentro de cada
ejercicio**: no hay habilidades transversales, ni histórico por habilidad, ni
nada que comparar con los requisitos de una oferta. La matriz ya lo tiene
anotado en B13.

Construirlo serían tres cosas, no una: un vocabulario de habilidades, un perfil
que se alimente de las evaluaciones, y un algoritmo de emparejamiento. Eso es
una línea de trabajo propia, sin paquete en la EDT, y **con un riesgo ético que
el propio proyecto se toma en serio**: un emparejamiento automático decide quién
ve qué oferta, y eso es el tipo de sesgo que la auditoría del paso 11 existe
para vigilar. No es algo que se añada de paso mientras se hace otra cosa.

Lo honesto era entregar el camino completo sin el motor, y decir que falta.

## La contradicción que esto NO resuelve, y hay que decirla

**El reclutador decide sobre una lista de identificadores.** La API devuelve
`idCandidato`, `estado` y `creadaEn`. Sin nombre, sin correo, sin CV.

Eso es coherente con el núcleo del producto —el ranking oculta la identidad
hasta que la empresa decide revelarla— pero tiene una consecuencia incómoda:

> **Si el reclutador no ve nada de la persona, aceptar o rechazar es
> arbitrario.**

Las tres salidas posibles, dichas en voz alta:

| Salida | Qué implica |
|---|---|
| **a.** Que el reclutador vea el perfil antes de decidir | Reintroduce el cribado por CV, que es exactamente lo que MeritIA existe para quitar |
| **b.** Aceptar a todo el mundo automáticamente | El reto pasa a ser el único filtro, que es la tesis del producto. Pero cada evaluación cuesta dinero, y `finalistasAEvaluar` es la base de cobro |
| **c.** El motor de afinidad de A04 | Lo que el diseño promete, y lo que no se puede construir todavía |

**Se implementó la decisión del reclutador porque es la única que no cierra
ninguna puerta**: el endpoint existe, y cambiar la política es cambiar quién
llama a `aceptar` —una persona, una regla automática, o un motor— sin tocar el
modelo de datos ni el control de acceso.

**Esto es una decisión de producto, no de backend, y le toca al equipo.** La
recomendación de quien escribe esto es la **(b) con un cupo**: el reto es el
filtro, y el cupo protege el coste. Pero eso cambia lo que A04 promete, así que
se decide fuera de un ADR.

## Lo que se ganó por el camino

**El motivo del rechazo es obligatorio**, mínimo 20 caracteres, y el candidato
lo lee en `GET /postulaciones/mias`. El diagrama del equipo pide «feedback de
por qué un candidato no avanzó» y esto es su cimiento: sin un texto escrito por
quien decidió, no hay nada que mostrar.

Y hace la decisión **auditable**: queda quién decidió, cuándo y por qué. Una
decisión a ciegas sigue siendo a ciegas, pero al menos no es anónima.

## Consecuencias

- **La solicitud y la invitación son tablas distintas.** `postulaciones` es la
  peticíon; `vacante_candidatos` sigue siendo el **único** sitio que concede
  acceso. Así el control de autorización no aprende un segundo camino, que es
  como se cuelan los fallos.
- **Aceptar es una transacción.** Si la invitación fallara después de marcar la
  postulación como aceptada, el candidato vería «aceptada» y seguiría sin poder
  entregar: el peor de los dos fallos posibles.
- **Las decisiones no se deshacen.** Ni aceptar —dejaría a alguien a medio
  reto— ni rechazar, porque el candidato ya recibió el motivo. Si la empresa se
  equivocó, puede invitar igual: queda como un acto nuevo y no como la
  reescritura de uno viejo.
- **El catálogo no filtra por nada del candidato.** Todos ven lo mismo. El día
  que eso cambie será una decisión con nombre, no un efecto secundario.
- **El front tenía esto simulado.** La rama `feat/flujo-completo` de `web` lo
  resolvía con un mock en el navegador, y su autor dejó escrito el contrato que
  haría falta. Estos endpoints son ese contrato, con una diferencia: el mock
  guardaba los postulantes en un almacén compartido del navegador, y aquí viven
  en la base con su dueño y su auditoría.

## Alternativa descartada: no abrirlo todavía

Dejar el producto solo con invitación hasta que exista el perfil de habilidades.
Se descartó porque deja al candidato sin ninguna forma de entrar, y porque el
catálogo abierto **no prejuzga** el motor: cuando exista, ordena este mismo
catálogo.
