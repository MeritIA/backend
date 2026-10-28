# Matriz pantalla → endpoint

> Contrato de trabajo entre los mockups y el backend. Dice, pantalla por
> pantalla, **qué endpoint ya existe**, **qué falta** y **qué queda fuera del
> alcance de la EDT**. Sirve para dos cosas: que el front sepa contra qué puede
> empezar a programar hoy, y que el equipo decida qué entra en el MVP.

- **Fuente de las pantallas**: `MeritIA_flujos_y_pantallas.zip` — 27 pantallas
  en tres flujos (A empresa ×10, B candidato ×14, C moderación ×3) y tres
  diagramas de flujo.
- **Fuente de los endpoints**: `docs/openapi.json`, generado del código.
  **47 operaciones** en el momento de escribir esto.
- **Fecha**: 26 de octubre de 2026.

---

## 1. Cómo se lee

| Marca | Significado |
|---|---|
| ✅ | El endpoint existe y cubre lo que la pantalla necesita. |
| ◐ | Existe el cimiento, pero la pantalla pide más de lo que devuelve. |
| ✗ | No existe nada en el backend. |
| ⛔ | Además, **no tiene paquete en la EDT**: construirlo es ampliar el alcance. |

Una advertencia que conviene leer antes que la matriz: **ninguna de las 27
pantallas se puede construir completa hoy**. Eso no es un fallo del backend; es
que los mockups describen un producto más grande que el que la EDT encarga. La
matriz separa las dos cosas para que nadie confunda «falta por hacer» con
«nunca se pidió».

## 2. Resumen

| Flujo | Pantallas | ◐ con cimiento | ✗ sin nada | De esas, ⛔ fuera de la EDT |
|---|---|---|---|---|
| A · Empresa | 10 | 9 | 1 | 1 |
| B · Candidato | 14 | 6 | 8 | 7 |
| C · Moderación | 3 | 0 | 3 | 3 |
| **Total** | **27** | **15** | **12** | **11** |

Dicho de otra forma: **15 pantallas se pueden empezar hoy** en una versión
reducida, y **11 de las 12 restantes describen producto que nadie encargó**.

---

## 3. Flujo A · Empresa

| # | Pantalla | Endpoints que ya existen | Qué falta |
|---|---|---|---|
| A01 | Verificar empresa | ◐ `POST /empresas`, `POST /empresas/{id}/usuarios` | **NIT y sector ya existen** (y el NIT se verifica por su dígito). Sigue faltando que la pantalla sea un **auto-registro**: el endpoint solo deja crear la empresa a un administrador de plataforma. La validación contra Cámara de Comercio es una integración externa ⛔. |
| A02 | Panel de vacantes | ◐ `GET /reportes/panel`, `GET /vacantes`, `GET /ejercicios` | **Los cuatro contadores, el «avance» y el «cierre estimado» ya salen en una sola llamada**: `abiertas[]` trae una fila por vacante publicada con invitados, cuántas personas entregaron, cuántas tienen evaluación y el porcentaje, ordenadas por lo que vence antes. El concepto de **contratado** existe. El banco de talento ⛔. |
| A03 | Diseñar reto y rúbrica | ◐ `POST /ejercicios`, `POST /ejercicios/{id}/versiones` | La suma 100 de los pesos **ya se valida**. Faltan: catálogo de **plantillas base**, estado **«validada jurídicamente»**, borrador de ejercicio, y el acompañamiento de RRHH ⛔. |
| A04 | Publicar y pago | ◐ `POST /vacantes`, `PUT /vacantes/{id}/ejercicios`, `POST /vacantes/{id}/publicar` | **«Finalistas a evaluar» ya existe**, como plan y no como tope: no impide invitar ni evaluar a más gente. Sigue faltando **todo el cobro** ⛔ —pasarela, referencia, estado, reintento— y con él la «remuneración por reto», que es dinero y no un dato suelto. Ver contradicción §6.1. |
| A05 | Pago rechazado | ✗ ⛔ | Ruta de excepción completa del cobro. Lo único que ya se sostiene es que la vacante quede **en borrador**, que es el estado que la pantalla describe. |
| A06 | Ranking de finalistas | ◐ `GET /reportes/vacantes/{id}`, `GET .../exportar`, `POST .../revelar` | El **alias**, el puntaje, el promedio, el CSV y la **habilidad destacada por fila** ya están, y revelar cubre «contactar seleccionados». Falta la columna **estado antifraude** ⛔. Ver §6.7 sobre el alias. |
| A07 | Ver entrega | ◐ `GET /reportes/vacantes/{id}/candidatos/{idCandidato}`, `GET /entregas/{id}`, `GET /entregas/{id}/descarga` | El desglose por criterio **con evidencia** ya está. La pantalla muestra el **texto del entregable en línea**; el backend entrega un enlace firmado al archivo, sin extraer el texto. Faltan «seleccionar para entrevista» y el estado de **derechos** ⛔. |
| A08 | Contratar y cerrar | ◐ `POST /vacantes/{id}/candidatos/{idCandidato}/contratar`, `POST .../cerrar`, `POST .../revelar`, `GET /notificaciones/vacantes/{id}` | **Marcar contratado ya existe**, con quién lo registró y cuándo, y **cerrar ya avisa por correo** a quienes participaron (§6.3, D-10): la pantalla puede mostrar el estado de cada aviso y reintentar lo que no salió. Falta el **mensaje directo al seleccionado**, que es decisión de la empresa y no un aviso automático ⛔. |
| A09 | Informe de auditoría | ◐ `GET /reportes/vacantes/{id}`, `GET .../exportar` | La **auditoría de sesgo** exige un dato que hoy no se recoge (§6.8). Las métricas de integridad vienen de moderación ⛔. «Descargar informe» es PDF; hoy solo hay CSV. |
| A10 | Banco de retos | ◐ `GET /ejercicios`, `GET /ejercicios/{id}`, `DELETE /ejercicios/{id}` | El banco **ya es reutilizable y versionado**. Faltan: estadísticas de uso por ejercicio, estado de validación, y toda la **suscripción** ⛔. |

## 4. Flujo B · Candidato

| # | Pantalla | Endpoints que ya existen | Qué falta |
|---|---|---|---|
| B11 | Crear cuenta | ◐ `POST /autenticacion/registro` | El registro público ya crea **solo candidatos**, como pide el flujo. Faltan los campos **documento**, **ciudad** y **cuenta para recibir pagos** — el documento es dato sensible y exigiría cifrado en reposo, igual que el correo. |
| B12 | Consentimientos | ◐ `GET /autenticacion/consentimientos`, `PUT /autenticacion/consentimientos` | **El registro existe y es revocable**: cada decisión guarda qué, cuándo, a qué versión del aviso y desde dónde, y revocar añade una fila en vez de borrar la anterior. **El de calificación por IA ya se hace cumplir**: revocarlo bloquea la entrega con un 403 que dice cómo volver atrás (D-17). Los otros tres siguen declarados como `vigilado: false` porque las funciones que gobiernan (proctoring, banco de talento, Mentor IA) no existen ⛔. Ver §6.10. |
| B13 | Perfil y reto gratuito | ◐ `GET /evaluaciones/mias` | Las evaluaciones propias con desglose ya están. Faltan: **perfil de habilidades** transversal (hoy los criterios viven dentro de cada ejercicio), **reto gratuito** sin vacante, y el **% de afinidad** ⛔. Ver contradicción §6.2. |
| B14 | Invitación a reto pagado | ◐ `GET /vacantes/{id}`, `GET /vacantes/{id}/ejercicios` | El enunciado y la rúbrica con sus pesos **ya se leen** (§6.5, arreglado al escribir esta matriz). Faltan: la invitación como objeto con **vencimiento de 72 h**, la remuneración y la elección de derechos ⛔. |
| B15 | Verificación técnica | ✗ ⛔ | Proctoring: cámara, micrófono, conexión. |
| B16 | Modalidad alterna sin cámara | ✗ ⛔ | Verificación manual equivalente y solicitud de ajuste razonable. |
| B17 | Reto pagado en curso | ◐ `GET /vacantes/{id}/ejercicios`, `POST /entregas` | La subida ya valida extensión (zip, pdf, md, txt, ipynb, sql, json…), tamaño (25 MiB) y ritmo. Faltan: **sesión cronometrada** del lado del servidor, **dataset adjunto** al enunciado, respuesta escrita en línea y grabación ⛔. Ver §6.4. |
| B18 | Entrega y cesión | ◐ `POST /entregas` | El acto de entregar existe. Faltan la **cesión de derechos con firma** y la liberación del pago ⛔. |
| B19 | Reto en revisión | ◐ `GET /entregas/{id}` | El **historial de estados con momento y motivo** ya es el esqueleto de esa línea de tiempo. Faltan el caso de moderación, la explicación del candidato y la retención del pago ⛔. |
| B20 | Caso restaurado | ✗ ⛔ | Resultado favorable de la revisión humana. |
| B21 | Descalificado | ✗ ⛔ | Decisión confirmada y **derecho a disputa** ante un segundo moderador. |
| B22 | Resultado y Mentor IA | ◐ `GET /evaluaciones/entrega/{idEntrega}`, `GET /evaluaciones/mias` | El puntaje, el desglose, **la versión de rúbrica con la que se calificó** y el **puesto** —con la vacante cerrada, `GET /evaluaciones/vacante/{id}/mi-puesto`— ya están. Faltan insignias, Mentor IA y tendencia del mercado ⛔. |
| B23 | Pago no procesado | ✗ ⛔ | Dispersión al candidato y su ruta de excepción. |
| B24 | Perfil público | ◐ `GET /autenticacion/consentimientos`, `PUT /autenticacion/consentimientos` | El panel **«Privacidad de tus datos» ya tiene detrás** sus interruptores, con el historial que la ley exige. Perfil público, insignias y banco de talento ⛔. Siguen sin ruta **«Descargar mis datos» y «Eliminar cuenta»**, que tampoco son ⛔: son obligaciones de la Ley 1581. |

## 5. Flujo C · Moderación

Las tres pantallas están en ✗ ⛔ y comparten un impedimento de raíz: **el rol
`Moderador` no existe**. `Rol` tiene tres valores —candidato, reclutador,
administrador— y la matriz de permisos no contempla a nadie que revise casos.

| # | Pantalla | Qué exigiría |
|---|---|---|
| C25 | Bandeja de casos | Cola de casos, origen (antifraude o **muestreo QA aleatorio**), SLA de 24 h, y la regla de que el revisor nunca sea del equipo que diseñó la rúbrica. |
| C26 | Revisión de caso | Evidencia de sesión, decisión binaria con **justificación obligatoria**, y el efecto de cada decisión sobre pago y ranking. Usa alias (`Candidato ••••55`), **coherente con lo implementado**. |
| C27 | Métricas del modelo | Tasa de falsos positivos y negativos, cobertura del muestreo y **tasa de marcas por grupo**, incluida la modalidad sin cámara. |

---

## 6. Contradicciones entre los mockups y el backend

No las resuelvo aquí: las nombro para que se decidan.

### 6.1 Publicar no es lo mismo que pagar

El backend publica una vacante cuando el reclutador lo pide, con la única
condición de que tenga al menos un ejercicio. A04 dice **«La vacante no se
activa hasta que el cobro sea aprobado»**. Son dos contratos distintos para la
misma acción. Si el cobro entra, `POST /vacantes/{id}/publicar` deja de ser el
botón que publica y pasa a ser un paso intermedio.

### 6.2 Invitación contra descubrimiento

En el backend, un candidato **ve únicamente las vacantes a las que fue
invitado**. En B13 descubre vacantes por **% de afinidad**, y A04 promete que
«MeritIA preselecciona por perfil de habilidades e invita solo a los
finalistas». Eso es un motor de preselección que no existe, y cambia quién
invita a quién: hoy invita el reclutador, uno por uno.

### 6.3 Cerrar la vacante contra revelar la identidad — **decidida**

En A08 **cerrar es lo que revela** la identidad del seleccionado y notifica el
resultado a los quince finalistas. En el backend, `cerrar` y `revelar` son dos
acciones independientes y **cerrar no notifica a nadie**.

Lo decidido el 26/10 (**D-9**): **cerrar no revela ninguna identidad, nunca**.
Automatizarlo volcaría todos los nombres de todos los procesos cerrados, que es
exactamente la protección que el producto vende; revelar sigue siendo un acto
deliberado y registrado. Y **marcar contratado** ya existe, con autor y fecha,
sin exigir que la identidad se haya revelado antes: pedirlo obligaría a
`vacantes` a preguntarle a `reportes`, que ya depende de `vacantes`, y no
protegería nada —quien no reveló no sabe a quién contrató—.

**Lo decidido el 27/10 (D-10): cerrar sí avisa por correo**, y a quienes
tuvieron al menos una entrega evaluada. El aviso dice que el proceso se cerró y
que el resultado está en la plataforma; **no lleva la nota, ni el puesto, ni si
la persona fue seleccionada**. Las dos preguntas abiertas quedaron respondidas
así:

- **Qué dice.** «El proceso se cerró», nunca «no fuiste seleccionado». Cerrar no
  es contratar, y comunicar un rechazo es una decisión de la empresa sobre su
  reputación, no el efecto secundario de un trabajo automático. La nota no va en
  el correo: se mira autenticada, junto a la rúbrica que la explica.
- **Quién aprueba escribirle a personas reales.** Nadie lo aprueba por omisión:
  `NOTIFICACIONES_A_CANDIDATOS` nace apagado (**D-11**) y existe
  `CORREO_REDIRECCION` para que el primer entorno con SMTP de verdad mande todo
  a una sola dirección del equipo. Con el canal apagado los avisos se registran
  igual como pendientes, así que encenderlo no deja a nadie sin aviso.

Queda **un límite escrito**: a quien fue invitado y no entregó nada no se le
avisa, porque el texto le sería falso —no tiene resultado que mirar—. Mandarle
otro texto es trabajo de producto que nadie ha decidido.

### 6.4 La entrega es un archivo, no una sesión

B17 es una sesión: arranca, corre un cronómetro de 45 minutos, se graba y
termina. `POST /entregas` es la subida de un archivo. Entre las dos hay un
objeto que no existe —el **intento como sesión con inicio y fin en el
servidor**—, y sin él el tiempo no se puede medir ni calificar.

### 6.5 El candidato no podía leer su propio reto — **arreglado**

Esta matriz lo destapó y se corrigió en el mismo trabajo, porque no era una
diferencia de criterio con el diseño: era un defecto. `ejercicios:leer` está
concedido a reclutador y administrador, **no a candidato**, y
`GET /vacantes/{id}` devuelve las filas de enlace (`idEjercicio`, `orden`), no
el enunciado. Se invitaba a una persona a resolver un ejercicio **que no tenía
forma de leer**: podía subir un archivo sin saber qué se le pedía ni cómo se le
iba a calificar.

Se añadió `GET /vacantes/{id}/ejercicios`, con tres decisiones:

- **La puerta es la vacante, no el banco.** El permiso para leer el enunciado
  nace de estar invitado a *esa* vacante, así que reusa el mismo control de
  acceso que la vacante y responde el mismo 404 a quien no entra. Un candidato
  sigue sin ver el banco de ejercicios de la empresa; hay una prueba que lo fija.
- **Devuelve la versión vigente**, que es exactamente la que el módulo de
  evaluación consulta para calificar. Que las dos lean lo mismo es lo que
  sostiene la promesa de B14: la rúbrica es pública y es la misma para todos.
- **Un borrador no se lee**, aunque el candidato ya esté invitado: el reto no
  existe para él hasta que la vacante se publica.

### 6.6 ¿El candidato ve su puesto? — **decidido: sí, con el proceso cerrado**

B22 le muestra **«Puesto 2 de 15 finalistas»**. El backend no se lo daba, y no
por descuido: el ranking es de la empresa, y decir el puesto filtra el tamaño y
la forma del proceso.

Resuelto el 26/10 con una condición en medio: **se da cuando la vacante está
cerrada, nunca antes**. Con el proceso abierto, el puesto cambia cada vez que
otro candidato entrega, así que no es información suya sino un canal lateral
sobre la actividad de los demás: quien consulte cada hora deduce cuándo entrega
la competencia. Con el proceso cerrado es un hecho final y auditable, y es lo que
hace interpretable la nota —un 72 sobre 100 no significa nada sin referencia— y
verificable la promesa meritocrática.

Lo que **no** se entrega nunca: el alias, el identificador ni la nota de ningún
otro. La respuesta tiene seis campos y hay una prueba que los fija. Queda como
decisión **D-8** de la Declaración de Alcance: si el equipo prefiere mostrarlo en
vivo, es una condición.

Y una consecuencia que conviene ver: `total` dice cuántos candidatos
participaron. Una vacante cerrada con un solo finalista le revela al candidato
que estaba solo.

### 6.7 El alias del ranking: dos caracteres contra seis

Los mockups muestran `Candidato ••••42`, `••••17`, `••••55`. Lo implementado usa
seis: `Candidato ••••3f8a2c`. **Me quedé con seis a propósito**: con dos dígitos
hay cien alias posibles, y entre quince finalistas la probabilidad de que dos
compartan alias pasa del 60 %. Dos filas iguales en la misma tabla no son
anonimato, son confusión. Si el diseño quiere ver dos caracteres, que el front
no trunque: hay que acortar el hash en el backend y asumir el cálculo.

### 6.8 La auditoría de sesgo necesita un dato que no se recoge

A09 compara el puntaje medio entre **Grupo A, B y C** con un umbral de 8 puntos
citando la Local Law 144 de Nueva York. El backend no guarda grupo demográfico
de nadie. El propio mockup dice cómo debería recogerse —autoreportado, anónimo,
**en un canal separado del proceso de evaluación**—, y eso es una decisión de
producto y de tratamiento de datos sensibles, no una consulta SQL.

### 6.9 Dos derechos legales sin endpoint

B24 ofrece **«Descargar mis datos»** y **«Eliminar cuenta»**. No tienen ruta. No
los cuento como fuera de alcance porque no son una funcionalidad opcional: son
obligaciones de la Ley 1581 que el producto ya le promete al candidato en
pantalla.

---

### 6.10 Las dos pantallas de permisos no piden lo mismo — **decidida (D-17)**

B12 pide **tres** permisos: grabación biométrica, calificación por IA generativa y publicación del perfil. El panel «Privacidad de tus datos» de B24 ofrece revocar **otros tres**: perfil visible, grabaciones biométricas y **datos para el Mentor IA**. Las dos listas no son la misma, y las dos diferencias importan:

1. **«Datos para el Mentor IA» se puede revocar en B24 pero nunca se pidió.** Tratar datos para una finalidad que el titular no autorizó es justo lo que la Ley 1581 prohíbe. En el backend nace **apagado** por eso, pero la pantalla de registro tendría que preguntarlo.
2. **«Calificación por IA generativa» se pide en B12 y no aparece en el panel de revocación**, aunque la propia B12 promete que «cada permiso es independiente y puedes revocarlo cuando quieras desde Mi perfil › Privacidad».

La segunda es la incómoda: **si ese permiso se puede revocar, quien lo apague no puede ser evaluado**, y evaluar es el producto entero. Había tres salidas:

- **No es revocable** y B12 no debería mostrarlo como interruptor, sino como una condición de uso que se acepta o no se entra. Es lo más honesto con lo que el producto hace.
- **Sí es revocable** y revocarlo significa salir de los procesos en curso. Hay que decir qué pasa con las entregas ya evaluadas y con el pago del reto.
- **Sí es revocable** y existe una evaluación humana alterna —que es lo que el propio texto del permiso insinúa al hablar de «revisión humana previa»—. Eso es el flujo C de moderación, que no tiene paquete ni backend ⛔.

**Decidido el 28/10 (D-17): la segunda, acotada.** El permiso **sí es revocable** —mantener la promesa de B12 pesó más que la comodidad de quitarla— y revocarlo significa **no poder entregar de aquí en adelante**. `POST /entregas` lo exige antes de aceptar nada y devuelve 403 con el texto que dice cómo volver atrás.

Se acota en dos sitios, y los dos son deliberados. **No se deshace lo ya hecho**: las entregas y evaluaciones anteriores se quedan, porque deshacerlas obligaría a decidir qué pasa con el pago del reto, que es cobro y está fuera de alcance. Y **no se ofrece la alterna humana** de la tercera salida, que sería lo mejor para el candidato, porque es el flujo C de moderación: no tiene paquete ni backend, y prometerla sería prometer algo que no existe.

La primera salida —que no fuera revocable— se descarta porque contradice el texto que la propia pantalla le enseña al candidato.

**Queda abierto en la pantalla**, y es trabajo de diseño, no de backend: B12 lo pinta como un interruptor más, al lado de uno marcado «Opcional», sin decir que apagarlo impide participar. El backend ya devuelve ese texto en el campo `efecto` de cada permiso, para que la pantalla lo muestre antes de que alguien lo apague sin saber lo que cuesta.

**Un límite conocido:** revocar **no detiene una entrega que ya está en la cola**. La revocación de la Ley 1581 mira hacia adelante y ese entregable se envió bajo un consentimiento válido en su momento; la ventana es de minutos, y cerrarla obligaría a inventar un estado de entrega que hoy no existe.

Los otros tres permisos siguen **registrados y sin vigilar** (`vigilado: false`), porque las funciones que gobiernan —proctoring, banco de talento, Mentor IA— no existen.

### 6.11 El flujo publica el perfil de todo el mundo — **resuelta (D-18)**

El BPM termina su camino feliz en el paso 13: **«Fin: pago recibido y perfil publicado — el candidato queda visible en el banco de talento»**. Automático, sin preguntar. B12 marca ese mismo permiso **«Opcional»** y lo deja **apagado**.

**Manda B12, y no es una opinión: el propio equipo ya había diagnosticado el defecto.** En el *Taller 2 · BPM y Wireframes*, entre los hallazgos del proceso:

> El consentimiento inicial se asume suficiente para cubrir todo el ciclo del dato: grabación biométrica, calificación por IA y **exposición posterior del perfil «visible para otras empresas» en el banco de talento**. No se modela un consentimiento diferenciado por cada uso posterior del dato.

Y el cambio que ese mismo documento propuso:

> Separar el consentimiento único en pasos diferenciados por finalidad **(grabación/biometría, calificación por IA, publicación del perfil a terceros en el banco de talento)**, cada uno revocable de forma independiente por el candidato.

Tres finalidades, nombradas. **Son exactamente las tres tarjetas de B12, en ese orden.** B12 no es un mockup más: es la implementación de esa corrección.

**Por qué el BPM sigue diciendo lo contrario.** El Taller 2 propuso seis cambios. El diagrama que hoy está en Figma aplicó tres —conectó la rama del falso positivo (Excepción 1), añadió la compuerta de pago con reintento (Excepción 2) y puso la auditoría de sesgo (Riesgo ético)— **y se dejó justo el del consentimiento**. No es que el BPM defienda otra postura: es que ese paso quedó sin rehacer.

Y el **Modelo de Negocio** lo confirma por el otro lado: las dos fuentes de ingreso son el **pago por adelantado al publicar la vacante, según el número de finalistas a evaluar** y la **suscripción mensual al banco de retos**. Ninguna depende de que el perfil de cada candidato se publique, así que pedir permiso no le quita dinero a nadie.

**Qué hay que cambiar:** el paso 13 del BPM, para que publique el perfil **solo con el permiso concedido**. El backend ya está así.

### 6.12 El Mentor IA no es una finalidad documentada — **resuelta (D-18)**

El paso 9 del BPM ejecuta el Mentor IA para todo el que no fue descalificado, y B24 ofrece un interruptor **«Datos para el Mentor IA»** que B12 nunca pide.

**Manda la lista del Taller 2, y el Mentor IA no está en ella.** Las finalidades documentadas son tres y están nombradas una por una. «Datos para el Mentor IA» aparece **solo en el panel de B24**: no en el Taller 2, no en la EDT —que no lo menciona en ningún paquete—, no en el Charter, no en el Plan de Seguridad, no en la propuesta tecnológica.

El Modelo de Negocio añade el dato que lo cierra: el mentor arranca **«con datos públicos de mercado laboral y después con datos propios de contratación a medida que crece el volumen»**. Al principio no trata datos del candidato para una finalidad nueva, así que **hoy no hay nada que consentir**.

**Decisión:** el permiso **se retira del catálogo**. Pedir un permiso que nadie necesita no es prudencia: entrena a la gente a decir que sí sin leer, que es lo contrario de lo que una pantalla de consentimientos busca. Sigue en el enum de la base para poder leer el historial —un registro de consentimientos que no puede leer su propio pasado no sirve para lo que existe— y escribirlo devuelve **400**.

**Cuando el mentor pase a usar «datos propios de contratación»**, como el propio Modelo de Negocio planea, vuelve a ser una finalidad: se añade al catálogo y **B12 tiene que preguntarla**.

**Qué hay que cambiar en el diseño:** el panel de B24 tiene dos errores, no uno. Le sobra «Datos para el Mentor IA» y **le falta «Calificación por IA»**, que sí es una de las tres y cuya revocación el backend ya hace cumplir (D-17).

## 7. Lo que el backend ya tiene y ninguna pantalla usa

El mapeo también funciona al revés, y ahí aparecen huecos de diseño:

| Endpoint | Por qué importa que no tenga pantalla |
|---|---|
| `POST /autenticacion/cerrar-sesiones` | Es lo que corta un token robado antes de que expire. Merece un botón en «Mi perfil». |
| `GET /reportes/vacantes/{id}/revelaciones` | El rastro de quién miró qué identidad. Un registro de auditoría que nadie consulta no es una auditoría: le falta su pantalla. |
| `GET /evaluaciones/cola` | Salud de la cola de evaluación. No hay panel de administrador de plataforma en los mockups. |
| `POST /evaluaciones/{idEntrega}/reintentar` | Reintento de una evaluación fallida, sin gastar intento del candidato. Nadie puede dispararlo desde la interfaz. |
| `POST /empresas/{id}/usuarios` | Alta de reclutadores. A01 da de alta la **empresa**, no a su gente. |
| `DELETE /ejercicios/{id}` | Retirar un ejercicio del banco. A10 ofrece «Ajustar» y «Terminar», no retirar. |
| `GET /salud`, `GET /salud/listo` | Operación; no necesitan pantalla, pero sí tablero. |

---

## 8. Propuesta de MVP del front

Si hay que elegir, propongo construir **el proceso completo sin dinero, sin
cámara y sin moderación**, que es casi exactamente lo que la EDT encarga. Diez
pantallas, todas con cimiento ya construido:

1. **A01 → A02 → A03 → A04 (sin pago) → A06 → A07 → A08 (sin contratación)**
2. **B11 → B14 → B17 → B22**

Con eso se demuestra el núcleo del producto: una empresa define un reto con su
rúbrica, invita candidatos, la IA califica contra esa rúbrica, y el reclutador
compara **sin ver nombres** hasta que decide a quién contactar, dejando rastro.

Los tres impedimentos que esta matriz encontró para arrancar **están
resueltos**: §6.5 (el candidato lee su reto), §6.6 (ve su puesto, con el proceso
cerrado) y §6.3 (cerrar no revela identidades, pero sí avisa por correo). **El
front puede empezar por cualquiera de las diez pantallas sin esperar una
decisión de backend.**

Lo demás —pagos, proctoring, moderación, MentorIA, perfil público, cesión de
derechos— está anotado en `docs/arquitectura.md` §10 como ampliación de alcance,
y debería entrar a la Declaración de Alcance antes de que alguien lo programe.
