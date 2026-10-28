# 0013 · Cerrar una vacante avisa por correo, y el aviso no lleva el resultado

**Estado:** vigente, apagado por defecto

## Contexto

Hasta el 27/10/2026 cerrar una vacante era silencioso. El candidato entregaba su
prueba y tenía que volver a entrar cada tanto a ver si el proceso había
terminado. La pantalla B22 le muestra su puesto, pero solo si se le ocurre
mirar: nada le dice cuándo mirar.

El dueño del producto decidió ese día que **sí debe avisarse, y por correo**. El
canal ya existía en el proyecto para las alertas de seguridad del paquete 5.5.

## Decisión

Al cerrarse una vacante se publica el evento `vacantes.vacante-cerrada`, y un
módulo nuevo, **`notificaciones`**, le escribe a cada candidato con al menos una
entrega evaluada.

**El correo dice que el proceso se cerró y que el resultado está en la
plataforma. Nada más.** No lleva la calificación, ni el puesto, ni el desglose de
la rúbrica, ni si la persona fue seleccionada o descartada, ni una palabra sobre
los demás participantes.

Cada aviso queda registrado en `notificaciones.avisos`, con un índice único
`(vacante, candidato, tipo)`.

El envío **nace apagado** (`NOTIFICACIONES_A_CANDIDATOS=false`) y existe
`CORREO_REDIRECCION`, que manda todo el correo a candidatos a una sola dirección
con el destinatario real en el cuerpo.

## Alternativas descartadas

**Mandar el resultado en el correo.** Es lo que la mayoría de plataformas hace y
es lo más cómodo para el candidato. Se descarta porque un correo viaja por
servidores ajenos, se reenvía y se queda en bandejas durante años, fuera de toda
autenticación. Un «57 sobre 100» suelto en un buzón es un juicio sobre una
persona sin la rúbrica que lo explica, y la minimización de datos de la Ley 1581
apunta al mismo lado. El resultado se mira autenticado, donde está la rúbrica.

**Decir si fue seleccionada.** Cerrar una vacante no es contratar. Y comunicar un
rechazo es una decisión de la empresa sobre su propia reputación, no el efecto
secundario de un trabajo automático.

**Avisar también a quien fue invitado y no entregó.** El texto le sería falso: no
tiene resultado que mirar. Mandarle otro texto distinto es trabajo de producto
que nadie ha decidido, así que queda como límite conocido y escrito.

**Poner el envío en `vacantes`, donde ocurre el cierre.** No se puede sin romper
las fronteras: quién participó lo sabe `evaluacion`, que ya importa `vacantes`,
y preguntarle de vuelta cerraría un ciclo entre módulos.

**Poner el envío en `reportes`,** que ya depende de los cuatro módulos. Reportes
es de solo lectura a propósito (ADR 0010): mandar correo desde ahí le daría
efectos secundarios al módulo que existe justamente para no tenerlos.

**No tener tabla y enviar al vuelo.** Sería un disparo al aire. El bus de eventos
es en memoria (ADR 0007 lo dice): si el proceso se cae entre el cierre y el
envío, el evento se pierde y ese candidato no se enteraría nunca, sin que nadie
pudiera saber que faltó avisarle.

**No tener interruptor y depender de que SMTP esté configurado.** Es la
alternativa que parece más simple y es la más peligrosa: SMTP existe hoy para
mandar alertas al equipo, así que configurarlo para eso empezaría a escribirle a
candidatos reales de rebote.

## Consecuencias

A favor: el candidato se entera el día que el proceso termina. Nadie recibe el
mismo aviso dos veces, y la garantía es de la base de datos —índice único más una
reserva de fila en estado `enviando`—, no del cuidado de quien llama. Queda
constancia de a quién se le escribió y cuándo, que es lo que permite responder a
un reclamo y a un derecho de acceso.

En contra, y hay que decirlo:

- **El aviso no basta por sí solo.** Quien no entre a la plataforma se queda
  sabiendo que el proceso cerró y nada más. Es el precio de no mandar la nota.
- **Hay un séptimo módulo.** El proyecto venía sosteniendo seis, y la
  arquitectura y la EDT lo dicen así. Esto es una divergencia con el documento, y
  queda dicha aquí en vez de resuelta en silencio. No añade ninguna arista al
  grafo de dependencias: importa a tres módulos y ninguno lo importa a él.
- **El envío es «al menos una vez», no «exactamente una vez».** Si el correo sale
  pero la fila no alcanza a marcarse —el proceso muere en ese hueco—, un reenvío
  manual podría repetirlo. Cerrar esa ventana del todo exige una clave de
  idempotencia del proveedor de correo, que hoy no hay.
- **Apagado no es gratis.** Mientras el interruptor esté en `false` el candidato
  no recibe nada. Los avisos se registran como pendientes y el reenvío los
  recoge, así que nadie se pierde, pero tampoco se entera hasta que alguien
  encienda el canal.
- **El texto no lo ha aprobado nadie fuera del equipo técnico.** Lo escribe una
  función pura con sus pruebas, justamente para que se pueda revisar y cambiar sin
  tocar nada más.

**Disparador de revisión:** si el producto necesita notificar más cosas —una
invitación, un recordatorio de plazo— la plantilla y el tipo de aviso ya están
preparados, pero el envío pasaría a necesitar una cola con reintentos como la de
evaluación. Hoy un fallo se reintenta a mano desde la pantalla de la vacante.
