# Declaración de Alcance — MeritIA (backend del MVP)

**Estado: BORRADOR para ratificar por el equipo.** El Diccionario de la EDT cita
una "Declaración de Alcance v1.0" como fuente de las funcionalidades por módulo
y de los criterios de aceptación, pero ese documento **no se ha localizado**
(ver [`reference_meritia_documentos`] y `fase-1-comprension.md §7`). Este
borrador lo reconstruye desde el Diccionario, el Plan de Seguridad v1.0 y el
código, para que exista algo que aprobar o corregir. **No sustituye al original
si aparece**; lo contradictorio manda en el original, no aquí.

Va aparte de los requisitos a propósito: los requisitos dicen *qué hace* el
sistema; esto dice *hasta dónde llega y dónde se detiene*, que es otra
conversación.

## 1. Propósito

Evaluar candidatos por ejercicios prácticos calificados con IA, para reducir la
dependencia del CV y minimizar sesgos. El MVP cubre el flujo completo de una
empresa cliente: crear ejercicios con rúbrica, invitar candidatos, recibir
entregas, calificarlas y consolidar resultados.

## 2. Dentro del alcance del backend

- Autenticación con PASETO y tres roles (candidato, reclutador, administrador).
- Empresas cliente con aislamiento total de datos entre ellas.
- CRUD de vacantes y banco de ejercicios con rúbricas versionadas.
- Entregas con control de intentos y trazabilidad de estados.
- Evaluación asíncrona con IA: cola, extracción de texto, calificación por
  rúbrica con evidencia, defensa anti prompt injection.
- Reportes consolidados por vacante y candidato, con exportación CSV.
- Observabilidad: health checks y alertas de seguridad por correo.
- Seguridad transversal: cifrado en reposo, rate limiting, autorización por
  recurso, gestión de secretos.

## 3. Fuera del alcance (exclusiones explícitas)

Se listan para que no se reclamen como huecos:

- **Frontend web y APK** (paquetes 3.1 y 3.2): son del backend solo en cuanto a
  CORS y transporte de token.
- **Analítica avanzada y métricas predictivas** en reportes: el Diccionario del
  5.1 las marca fuera del MVP.
- **Onboarding del cliente piloto, manual de usuario y operación del piloto**
  (5.3, 5.4, 5.6): son entregables de proceso, no de código.
- **Cualquier funcionalidad no respaldada por un documento.** El encuadre
  prohíbe inventarla.

## 4. Decisiones de producto que esta declaración fija

Son decisiones que **ningún documento tomó** y que el código tuvo que resolver.
Se registran aquí porque son exactamente lo que una Declaración de Alcance
decide. **Cada una está abierta a que el equipo la cambie.**

| # | Decisión tomada | Alternativa descartada | Por qué |
|---|---|---|---|
| D-1 | En el ranking puntúa el **mejor** intento del candidato | Puntuar el último | Los reintentos existen para que muestre lo que sabe; puntuar el último los vuelve un riesgo. El detalle muestra todos los intentos, así que nada queda oculto |
| D-2 | El servicio de IA **no es dependencia crítica** del health check | Marcarlo crítico | Sin IA se siguen recibiendo entregas; la cola evalúa al volver. Marcarlo crítico apagaría el backend por algo ajeno a la entrega |
| D-3 | El módulo de reportes **no tiene esquema propio**: compone en vivo | Proyección materializada | Una copia de las notas se desincroniza y contradice a la evaluación. Para el MVP las cifras caben en vivo (ver `rendimiento.md`) |
| D-4 | El almacenamiento de objetos en desarrollo es **SeaweedFS**, no MinIO | Seguir con MinIO | MinIO retiró sus imágenes públicas. Producción puede usar S3 real o MinIO con licencia |
| D-5 | Qué intento puntúa, D-1, **espera ratificación** del dueño del producto | — | Es una decisión de negocio, no técnica |
| D-6 | El **sector** de una empresa sale de una lista cerrada de catorce entradas (`dominio/sector.ts`) | Texto libre; o la CIIU del DANE | Texto libre no se puede agrupar: "Financiero", "finanzas" y "banca" serían tres sectores y el informe saldría vacío. La CIIU tiene más de 500 clases y nadie la elige bien en un registro. **Ratificada el 27/10/2026** por el dueño del producto, que delegó la decisión. Sale del campo de la pantalla A01 y de la pregunta del review del 26/10. Añadir un sector exige una migración y una decisión, no es un campo que crezca solo |
| D-7 | El **NIT** es opcional, pero si se declara se verifica su dígito y es único | Exigirlo siempre; o aceptarlo sin verificar | La verificación con Cámara de Comercio que pide A01 no existe. Exigir un dato que no se puede contrastar da una validez que el sistema no respalda; aceptarlo sin verificar tira la única comprobación disponible |
| D-8 | El candidato ve **su puesto y el total de participantes solo con la vacante cerrada** | Mostrarlo en vivo; o no mostrarlo nunca | En vivo, el puesto cambia cada vez que otro entrega: es un canal lateral sobre la actividad de terceros. Nunca, y la nota queda sin referencia: 72 sobre 100 no se puede interpretar. Cerrado es un hecho final y auditable. **Consecuencia aceptada**: el total le revela cuánta gente participó |
| D-9 | **Cerrar una vacante no revela ninguna identidad**, y contratar **no exige** haberla revelado antes | Que cerrar revele y notifique; o exigir la revelación para contratar | Automatizar la revelación al cerrar volcaría todos los nombres de todos los procesos, que es justo la protección que el producto vende. Exigirla para contratar obligaría a `vacantes` a preguntarle a `reportes`, que ya depende de `vacantes` —un ciclo entre módulos—, y no protegería nada: quien no reveló no sabe a quién contrató. Lo de notificar por correo se decidió el 27/10: ver D-10 |
| D-10 | **Cerrar una vacante avisa por correo** a quienes tienen al menos una entrega evaluada. El correo **no lleva la nota, ni el puesto, ni si fue seleccionada**: dice que el proceso se cerró y que el resultado está en la plataforma | No avisar; o mandar el resultado en el correo; o avisar también a quien no entregó | No avisar deja al candidato volviendo a entrar a adivinar si terminó. Mandar la nota la deja suelta en un buzón durante años, sin la rúbrica que la explica y fuera de toda autenticación: la minimización de la Ley 1581 apunta al mismo lado. A quien no entregó el texto le sería falso —no tiene resultado que mirar—, y se deja dicho como límite conocido |
| D-11 | El aviso a candidatos **nace apagado** (`NOTIFICACIONES_A_CANDIDATOS=false`) y hay una variable que redirige todo el correo a una sola dirección | Encenderlo con SMTP; o no tener interruptor | SMTP existe hoy para mandar alertas de seguridad al equipo. Sin interruptor, configurarlo para eso empezaría a escribirle a candidatos reales de rebote, sin que nadie lo decidiera. Con el canal apagado los avisos se registran igual como pendientes, así que encenderlo no deja a nadie sin aviso |
| D-12 | El **avance** de una vacante es el porcentaje de **invitados** que ya tienen evaluación, y es `null` —no 0— cuando no hay nadie invitado | Dividir por los «finalistas a evaluar» planeados; o devolver 0 sin invitados | El plan lo puede cambiar el reclutador a mitad del proceso, y la barra retrocedería sin que nadie hubiera deshecho nada. Un 0 % dice «esto está parado» cuando la verdad es «no ha empezado», y la pantalla necesita distinguirlos para pedir que se invite a alguien. El plan viaja igual en la respuesta, así que la pantalla puede decir «12 evaluados de 10 planeados» |
| D-13 | El **cierre estimado no cierra la vacante**, y se aceptan fechas pasadas | Cerrar automáticamente al llegar la fecha; o rechazar fechas pasadas | Cerrar dispara avisos por correo a personas reales (D-10) y eso no puede dispararlo un reloj que nadie miró; además habría que decidir qué pasa con las entregas en vuelo. Rechazar el pasado escondiría que un proceso está vencido, que es justo lo que el panel tiene que mostrar, y haría fallar al frontend que reenvía el objeto completo al editar el título |
| D-14 | Los consentimientos son una **tabla que solo crece**: revocar inserta una fila con `concedido = false` | Un booleano por permiso en `usuarios`, que se sobrescribe | Un booleano dice lo que la persona autoriza hoy y pierde todo lo demás. La Ley 1581 no pide el estado: pide poder **demostrar** que se obtuvo el consentimiento, para qué finalidad y cuándo. Borrar el rastro de un consentimiento es perder la prueba de que existió |
| D-15 | El backend **registra** los permisos y **no los hace cumplir**, y lo dice en la respuesta (`vigilado: false`) | Callarlo; o inventar el comportamiento de cada permiso | Las cuatro funciones que gobiernan —proctoring, banco de talento, Mentor IA— no existen, y la cuarta espera la decisión de §6.10. Una pantalla que promete control sobre algo que nadie vigila es peor que no prometerlo; inventar el efecto sería inventar producto |
| D-16 | «Datos para el Mentor IA» nace **apagado** aunque B24 lo muestre encendido | Nacer encendido, como lo pinta la pantalla | B12 nunca lo pide, así que nadie lo autorizó. Tratar datos para una finalidad no autorizada es exactamente lo que la Ley 1581 prohíbe. La pantalla de registro tendría que preguntarlo: anotado en §6.10 |

## 5. Supuestos

- El cliente piloto aporta candidatos reales y ejercicios reales.
- El proveedor de IA (Gemini) está disponible; su caída degrada pero no detiene
  la recepción de entregas.
- La auditoría externa comprometida en el Plan de Seguridad ocurre antes del
  piloto.

## 6. Criterios de aceptación del alcance

El backend se considera completo cuando se cumplen las 24 casillas de la sección
22 del encuadre. Hoy quedan abiertas, con su motivo, en
[`requisitos.md`](requisitos.md) y en `arquitectura.md §11`. Las dos que
dependen de documentos ajenos a este equipo:

- "Los requisitos de los documentos están implementados" — inverificable hasta
  que aparezca el documento de requisitos original.
- El alcance del red team — necesita que el equipo acuerde superficies y tiempo.

## 7. Qué pasa cuando aparezca la Declaración original

Si el documento v1.0 se localiza, este borrador se compara contra él. Donde
difieran, **manda el original** y aquí se registra la diferencia como se hace
con toda contradicción entre documentos (encuadre, invariante 1): nombrarla,
explicar su impacto, no resolverla en silencio.
