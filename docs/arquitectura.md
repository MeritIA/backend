# Arquitectura del backend de MeritIA

> Documento de arquitectura del sistema, entregable del paquete **5.2** de la EDT.
> Refleja el estado del código en la rama `main`. Cuando una decisión cambie, se
> actualiza aquí en el mismo *pull request* que la introduce.

---

## 1. Qué es MeritIA

Plataforma que permite a una empresa publicar vacantes, asignar ejercicios
técnicos a sus candidatos, recibir las entregas y obtener un reporte de
evaluación generado con apoyo de inteligencia artificial bajo rúbricas
definidas.

El propósito, según el *Project Charter*, es que la evaluación técnica sea más
objetiva, trazable y escalable que la revisión manual, reduciendo la dependencia
del CV tradicional y los sesgos del proceso.

## 2. Forma general: monolito modular

Un único proceso desplegable, organizado internamente en módulos con fronteras
explícitas, más **un servicio de IA separado desde el primer día**.

```
   Angular (web)  ─┐
                   ├─ HTTPS ─→  backend MeritIA  ─→  PostgreSQL   (datos estructurados)
   APK Capacitor  ─┘             (monolito)       ─→  S3 compatible (entregas, evidencias)
                                      │
                                      └─ cola (Redis) ─→  servicio de IA  ─→  proveedor LLM
```

**Por qué no microservicios.** El equipo es de cinco personas y no existe
necesidad de desplegar ni versionar componentes por separado. Dividir el sistema
añadiría coste operativo sin beneficio en esta etapa. El monolito modular
conserva las fronteras internas, de modo que extraer un módulo más adelante sea
un trabajo acotado y no una reescritura.

**Por qué el servicio de IA sí va aparte.** Su comportamiento no se parece al
del resto: picos de cómputo, respuestas de segundos o minutos y dependencia de
un proveedor externo. Aislarlo evita que su carga afecte a la plataforma y
permite cambiar de proveedor sin tocar el dominio.

## 3. Los seis módulos

| Módulo | Responsabilidad | Esquema en PostgreSQL |
|---|---|---|
| `autenticacion` | Registro, inicio de sesión, renovación de token y roles | `autenticacion` |
| `vacantes` | Ofertas de trabajo y su asociación con ejercicios | `vacantes` |
| `ejercicios` | Banco de pruebas técnicas con rúbricas y versiones | `ejercicios` |
| `entregas` | Intentos de los candidatos y su estado | `entregas` |
| `evaluacion` | Orquesta la calificación contra el servicio de IA | `evaluacion` |
| `reportes` | Resultados consolidados por vacante o candidato | `reportes` |

Los nombres van en español porque así los nombran el planteamiento de
arquitectura y la EDT. Un paquete como *2.2 CRUD de Vacantes* apunta a
`src/modules/vacantes/` sin traducción de por medio.

### 3.1 La regla de fronteras

> Ningún módulo importa una entidad o un repositorio de otro. Toda interacción
> pasa por el servicio de aplicación que el módulo reexporta en su `index.ts`, o
> por eventos de dominio.

**Es verificable por herramienta, no un acuerdo de palabra.** `npm run lint`
falla si alguien la incumple; la regla vive en `eslint.config.mjs`.

```ts
import { EntregasService } from '../entregas/index.js';            // permitido
import { EntregasService } from '../entregas/entregas.service.js'; // el lint falla
```

Para el flujo que encadena `entregas → evaluacion → reportes` se usan **eventos
internos** en lugar de llamadas directas, de modo que cada módulo quede
desacoplado del siguiente.

El canal es `BusDeEventos` (`src/common/events/`). Quien publica no sabe quién
escucha: entregas publica `entregas.entrega-completada` con solo identificadores,
y evaluación (4.5) se suscribirá por ese nombre sin importar nada más de
entregas que el nombre y el tipo de los datos.

- **Se publica después del commit.** Si se publicara dentro de la transacción,
  un suscriptor podría buscar una entrega que aún no existe para nadie más.
- **La entrega es asíncrona.** Un suscriptor lento o que falla no hace lenta ni
  fallida la petición del candidato; su error se registra y no llega a los demás.
- **Vive en memoria.** Si el proceso se cae entre el commit y la entrega del
  evento, ese evento se pierde. Desde el paquete 4.1 eso no pierde la
  evaluación: un barrido cada cinco minutos vuelve a encolar las entregas que
  llevan más de dos minutos en `recibida` (ver 3.1.2).

### 3.1.2 Cola de evaluación (paquete 4.1)

Evaluación escucha `entregas.entrega-completada` y encola un trabajo en BullMQ
sobre Redis. La petición del candidato ya respondió cuando eso ocurre.

| Pregunta | Respuesta |
|---|---|
| ¿Qué viaja por Redis? | Solo el UUID de la entrega. Nada personal: Redis no cifra en reposo. |
| ¿Y si el servicio de IA falla? | 5 intentos con backoff exponencial y jitter (15 s, 30 s, 60 s, 120 s) y 120 s de tiempo máximo por intento. Configurable con `COLA_*`. |
| ¿Y si agota los intentos? | La entrega pasa a `fallida` con un motivo genérico (el detalle técnico va solo al log), el trabajo se conserva 30 días y un administrador lo reintenta con `POST /api/v1/evaluaciones/{idEntrega}/reintentar`, sin gastar intento del candidato. |
| ¿Y si el error no se arregla reintentando? | `EvaluacionNoReintentableError` la marca `fallida` al primer fallo. |
| ¿Y si muere el worker a mitad? | BullMQ detecta el bloqueo vencido y devuelve el trabajo a la cola; a los dos abandonos seguidos se da por fallido. |
| ¿Y si se reinicia Redis? | Redis corre con AOF (`compose.yaml`): pierde como mucho el último segundo, y el barrido recupera lo que falte. |
| ¿Se puede evaluar dos veces? | No. El id del trabajo es el de la entrega, y una entrega ya `evaluada` termina sin llamar al servicio de IA. |
| ¿Qué ve el candidato? | `estado` (`recibida` → `en_evaluacion` → `evaluada`/`fallida`) y `enProcesoDeEvaluacion`. |
| ¿Cómo se vigila? | `GET /api/v1/evaluaciones/cola` (administradores): en espera, activos, reprogramados, fallidos, completados. |

`COLA_WORKER_HABILITADO=false` apaga el consumo en un proceso, para que en
producción las instancias que atienden la API no carguen con las evaluaciones.

Mientras no exista el servicio de IA (4.4), el evaluador registrado falla de
forma honesta: las entregas agotan sus intentos y quedan `fallida`, listas para
reintentarse cuando el adaptador esté conectado. No se inventa ninguna nota.

### 3.1.1 Entregas: intentos, estados y trazabilidad

| Regla | Cómo se garantiza |
|---|---|
| No se excede el número de intentos | `intentos_permitidos` en la vacante (1 por omisión, 1–10, solo editable en borrador). Se cuenta por candidato y ejercicio dentro de una transacción con `pg_advisory_xact_lock`; el índice único sobre el número de intento es la red de seguridad. |
| El estado es consultable y trazable | `recibida → en_evaluacion → evaluada \| fallida`, `fallida → en_evaluacion` (reintento sin gastar intento del candidato). Cada cambio escribe una fila en `historial_estados` con su motivo; `cambiarEstado` bloquea la fila para que dos evaluadores no tomen la misma entrega. |
| Solo quien corresponde ve una entrega | El candidato autor, el reclutador de la vacante o un administrador. A los demás, 404 y no 403. |
| El archivo no miente sobre su tipo | El `Content-Type` se deduce de la extensión validada, no del que declara el cliente. El nombre original se guarda cifrado. |
| No quedan archivos huérfanos | Si la inserción o el commit fallan, el objeto subido se borra. |

### 3.1.5 Reportes consolidados (paquete 5.1)

El reclutador consulta el ranking de una vacante, el detalle de un candidato y
una exportación en CSV. Tres rutas, todas colgadas de una vacante.

**Este módulo no es dueño de ningún dato.** No tiene entidades, ni
repositorios, ni migración: compone lo que ya existe en evaluación, entregas,
vacantes y autenticación, cada uno por su puerta pública.

Es una **divergencia consciente con el Diccionario de la EDT**, que lista
"esquema de reportes" entre los recursos del paquete. El motivo: una tabla
propia sería una copia de las notas, y una copia se desincroniza —un evento
perdido, un reinicio a medias— y entonces el reporte contradice a la
evaluación, que es el dato que un candidato puede disputar. Para el MVP no hace
falta: el ranking de una vacante son decenas de filas, no millones. Si el
piloto pide analítica que no aguante esta vía, el paso natural es proyectar por
el evento `evaluacion.evaluacion-finalizada`, que el paquete 4.5 ya publica
justo para esto.

**Qué intento puntúa: el mejor.** Un candidato puede entregar varias veces, y el
ranking lleva una fila por persona. Ningún documento define cuál de sus notas
cuenta. Se toma la más alta porque los reintentos existen para que el candidato
muestre lo que sabe: puntuar el último intento convertiría cada intento extra en
un riesgo, y la gente dejaría de usarlos. El detalle por candidato devuelve
**todos** los intentos, así que nada queda escondido: el reclutador ve de dónde
sale la nota del ranking. **Queda anotado para la Declaración de Alcance.**

**El promedio de la vacante es por candidato, no por evaluación.** Quien entregó
cinco veces no pesa cinco veces en el promedio.

**El promedio por criterio va en porcentaje logrado**, no en puntos crudos: dos
criterios con escalas distintas no se comparan en bruto. Se ordena del criterio
más flojo al más logrado, que es donde está el hallazgo para el reclutador.

**El aislamiento por empresa no se reimplementa aquí.** Toda lectura entra por
`VacantesService.obtenerPara` o `EvaluacionService.deVacante`, que ya exigen el
acceso y responden 404. Comprobarlo otra vez en reportes crearía un segundo
sitio donde la regla puede quedarse vieja. Y no existe un reporte "de un
candidato" suelto: ese mostraría su historial en otras empresas, que es justo lo
que el tercer criterio del paquete prohíbe.

**El reporte identifica a las personas.** Para eso autenticación expone
`identidadesDe`, que devuelve nombre y correo en lote y nada más —no el usuario
entero, que llevaría el hash de la contraseña por todo el monolito—. Que el
reclutador vea el correo no abre nada: es el correo con el que él mismo invitó al
candidato.

**Las entregas se cuentan en la base, agrupadas por estado.** El reporte
necesita saber si el ranking está completo o si falta gente por evaluar, pero no
necesita las entregas: su nombre de archivo está cifrado en reposo, y cargarlas
para contarlas obligaría a descifrar un dato personal que al reporte no le hace
ninguna falta.

#### El CSV y la inyección de fórmulas

Una celda que empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro no es
texto para Excel, LibreOffice ni Sheets: es una fórmula, y se ejecuta al abrir
el archivo. Hay fórmulas que leen otras celdas y las envían a una URL
(`HYPERLINK`, `WEBSERVICE`, `IMPORTDATA`), y otras que lanzan un ejecutable por
DDE.

Aquí el riesgo no es teórico. **El nombre del candidato lo escribe el candidato**
y la validación del registro admite guiones y puntos, así que `-Sara Gomez` es
un nombre válido que llega al CSV. La evidencia, además, la escribe un modelo a
partir de los archivos que subió un tercero. Se neutraliza anteponiendo un
apóstrofo, que es lo que recomienda OWASP: la hoja lo trata como texto y no lo
muestra en la celda. Hay una prueba de integración que lo comprueba de extremo a
extremo, con un candidato registrado con ese nombre.

El CSV empieza con BOM porque Excel en Windows, sin él, lee el archivo como ANSI
y destroza cualquier acento. El equipo trabaja en español.

### 3.2 Organización del código

```
src/
├── main.ts                  arranque, CORS y publicación de OpenAPI
├── app.module.ts            raíz: registra los seis módulos
├── config/                  validación de variables de entorno
├── database/                conexión, esquemas y migraciones versionadas
├── docs/                    generación de la especificación OpenAPI
├── common/                  transversal de verdad; sin lógica de negocio
│   ├── cifrado/             AES-256-GCM y transformador de TypeORM
│   ├── cors/                política por tipo de cliente
│   ├── rate-limit/          límites multicapa con Redis
│   └── events/             contrato de los eventos de dominio
└── modules/                 los seis módulos de negocio
    └── <modulo>/
        ├── index.ts         interfaz pública: lo que no se reexporta es interno
        ├── <modulo>.module.ts
        └── <modulo>.service.ts
```

### 3.1.3 Evaluación: del evento a la nota (paquete 4.5)

El módulo de evaluación es el único que habla con el servicio de IA, y lo hace
siempre desde la cola. El recorrido de una entrega:

1. Entregas publica `entregas.entrega-completada`; evaluación lo encola.
2. El worker toma el trabajo y marca la entrega `en_evaluacion`.
3. Descarga el archivo y **extrae el texto en el backend**.
4. Pide al banco la **versión vigente** de la rúbrica del ejercicio.
5. Llama al servicio de IA con enunciado, rúbrica y texto.
6. Valida la respuesta, la guarda en una transacción y publica
   `evaluacion.evaluacion-finalizada` después del commit.

**La extracción de texto vive aquí, no en el servicio de IA.** Decisión del
equipo (2026-09-23): el servicio de IA no procesa archivos no confiables. Abrir
un comprimido que subió un desconocido es superficie de ataque; el servicio solo
recibe texto, que es lo único que necesita para calificar.

| Defensa al extraer | Límite |
|---|---|
| Bomba de descompresión | Máximo 200 archivos, 500 KB por archivo y 1,5 MB en total, leyendo entrada por entrada |
| Zip slip | yauzl rechaza el comprimido entero ante una ruta con `..` o absoluta; el filtro propio se mantiene como defensa en profundidad |
| Binario disfrazado | Solo extensiones de texto, y se descarta lo que traiga bytes nulos |

**Qué pasa cuando la entrega no se puede leer.** Un `.pdf`, un `.tar`, un `.zip`
corrupto o uno sin archivos de texto no son un fallo del servicio de IA: la
entrega queda **`fallida`** con un motivo entendible para el candidato, **no se
reintenta** (repetir no cambia el archivo) y **no se gasta ni una llamada al
modelo**. Los `.pdf` se admiten al subir pero todavía no se evalúan de forma
automática; leerlos es trabajo pendiente.

**No se confía en la respuesta del servicio de IA.** Aunque él ya valida la
salida del modelo, el backend la vuelve a comprobar antes de tocar la base:
identificador que corresponde a la petición, nota entre 0 y 100, un criterio por
cada uno de la rúbrica, puntajes dentro de su escala y evidencia no vacía. El
peso y la escala se toman de **nuestra** rúbrica, nunca de la respuesta.

**Qué se guarda.** Una fila por evaluación con la **versión de rúbrica aplicada**
(la rúbrica puede cambiar; la nota tiene que poder explicarse con el texto
exacto contra el que se calificó), el proveedor y el modelo usados, y una fila
por criterio con su puntaje y su evidencia. El índice único sobre la entrega es
lo que hace idempotente al worker: reencolar una entrega ya evaluada no vuelve a
llamar al modelo ni duplica la nota.

**Quién puede verla.** El candidato que entregó, y la empresa dueña de la
vacante. A los demás, 404.

**Probarlo con IA real.** Las pruebas de integracion usan un doble del
servicio de IA: son repetibles y no gastan cuota. Para ver una calificacion de
verdad hay un guion aparte, que no corre en la integracion continua porque
necesita API key y cuesta dinero:

```bash
cd ../ai-service && docker compose up -d --wait
cd ../backend && node --env-file=.env scripts/humo-evaluacion.mjs
```

Crea empresa, reclutador, ejercicio con rubrica, vacante, candidato y entrega, y
espera la nota. Verificado el 2026-10-03: una entrega con un error real
(`reverse()` que muta la lista original) saco 1/5 en correccion funcional con
evidencia concreta, y 32/100 de nota ponderada.

Dos cosas que costaron encontrar y quedan escritas:

- **El modelo por omision es `gemini-3.5-flash`.** El `gemini-2.5-flash` que usa
  el README del SDK ya no se sirve a cuentas nuevas (404). Los mas nuevos (3.6
  en adelante) devolvian 503 por demanda.
- **`AI_SERVICE_URL` apunta a `127.0.0.1`, no a `localhost`.** `localhost`
  resuelve primero a IPv6 y los puertos que publica Docker escuchan en IPv4, asi
  que `fetch` fallaba con un `TypeError` sin causa visible. El cliente registra
  ahora el codigo de errno, que es lo que permitio verlo.

**Sin servicio de IA configurado** (`AI_SERVICE_URL` y `AI_SERVICE_API_KEY`), la
cola usa el evaluador honesto del paquete 4.4: falla en vez de inventar una nota.

### 3.1.4 Auditoría anti inyección (paquete 4.2)

El servicio de IA detecta y marca; el backend **persiste y expone**, porque es
el único con base de datos.

Cada evaluación guarda el riesgo, el puntaje, las banderas y las **versiones**
de las reglas y de la lista negra con las que se analizó. El criterio del
paquete pide un registro de auditoría con «prompt original, prompt sanitizado,
banderas y respuesta del modelo»; esto es lo que se guarda y por qué:

| Pieza | Dónde está |
|---|---|
| Prompt original | El archivo de la entrega, en el almacenamiento de objetos, con su hash |
| Prompt sanitizado | Reproducible: mismo original y misma versión de reglas dan el mismo texto. Se guarda su **SHA-256** como prueba de lo enviado |
| Banderas de seguridad | Columnas `riesgo_inyeccion`, `puntaje_inyeccion`, `banderas` |
| Respuesta del modelo | La nota y las calificaciones por criterio, con su evidencia |

**No se duplica el texto de la entrega.** Hacerlo significaría mantener dos
copias de información personal, cifrarlas y rotarlas las dos, y borrarlas las
dos cuando alguien ejerza su derecho de supresión.

**Quién ve el análisis.** El reclutador de la vacante y los administradores. Al
candidato **no**: saber qué patrón se detectó y con qué puntaje es justo lo que
necesitaría para afinar el siguiente intento.

**Si el servicio no devuelve el análisis** (un despliegue desfasado), la
evaluación no se pierde: se guarda con versión `ausente`, que deja constancia
de que esa entrega no pasó por la detección. Guardar «ninguno» sin más haría
indistinguible «no había indicios» de «no se miró».

**Límite de diez evaluaciones por minuto y por usuario** (Plan §6.2). De paso se
corrigió un hueco: el limitador que llamábamos «usuario» contaba por IP, porque
`@nestjs/throttler` rastrea por IP salvo que se le diga otra cosa. Dos
candidatos en la misma red corporativa compartían cupo y una cuenta con varias
IP lo multiplicaba. Ahora, con sesión abierta se cuenta por identificador de
usuario; sin sesión —registro, login— se sigue contando por IP, que es lo único
que hay.

## 4. Datos

**PostgreSQL, un clúster, un esquema por módulo.** No hay un `public`
compartido. Da aislamiento lógico real desde el principio, evita choques de
nombres y deja que las migraciones de cada módulo avancen por separado.

**Los binarios no van a la base de datos.** Las entregas de los candidatos y las
evidencias de evaluación viven en almacenamiento de objetos compatible con S3
(SeaweedFS en local; ver §10).

**Toda modificación estructural pasa por una migración versionada.**
`synchronize` está en `false` de forma permanente: con él activo, TypeORM altera
el esquema para que case con las entidades, y en producción eso puede borrar
columnas y datos sin aviso.

```bash
npm run migration:run       aplica las pendientes
npm run migration:revert    revierte la última
npm run migration:show      lista el estado
```

## 5. Seguridad

La arquitectura de seguridad está fijada en el **Plan de Seguridad v1.0**,
aprobado el 4 de septiembre de 2026. Lo que sigue es lo ya implementado.

### 5.1 Autenticación

**PASETO v4 con firma Ed25519**, no JWT. El Plan justifica la elección: PASETO
elimina los algoritmos inseguros y las opciones mal configurables que JWT
permite por defecto, y para una plataforma propia sin identidad federada no hace
falta la compatibilidad con OAuth/OIDC que JWT aporta.

El campo `exp` viaja como cadena ISO8601, no como *timestamp* Unix.

> **Pendiente**: el módulo de autenticación es el paquete 2.1 y todavía no está
> implementado. El Plan **no especifica el algoritmo de hashing de contraseñas**;
> hay que decidirlo antes de construirlo (la recomendación OWASP sería
> *argon2id*). Por eso la imagen de Docker es Debian *slim* y no Alpine: tanto
> `argon2` como `bcrypt` compilan módulos nativos que fallan con musl.

### 5.2 Autorización

Por **endpoint, recurso y operación**. Tres roles: candidato, reclutador y
administrador. Pertenecer al rol correcto no basta si el recurso es de otro
usuario: cambiar un identificador en la petición nunca puede dar acceso.

### 5.3 Cifrado en reposo

Transformador de TypeORM que cifra al escribir y descifra al leer:

```ts
@Column({ type: 'text', transformer: columnaCifrada() })
documentoIdentidad!: string;
```

**AES-256-GCM**, formato de almacenamiento `iv:authTag:ciphertext` en base64,
clave desde `ENCRYPTION_KEY`. Se cifran las credenciales de API de terceros, la
información de identificación personal y los tokens guardados en base de datos.

Se usa GCM y no CBC porque autentica la integridad: una fila manipulada
directamente en la base de datos hace fallar el descifrado en lugar de devolver
datos que la aplicación tomaría por buenos.

> **Limitación a tener en cuenta**: el IV es aleatorio en cada cifrado, así que
> el mismo valor produce resultados distintos. Eso impide deducir que dos filas
> coinciden, pero también impide comparar por igualdad o indexar la columna. Si
> hiciera falta buscar por un dato sensible, se guarda aparte un hash
> determinista de ese valor y se busca por el hash.

### 5.4 CORS

Lista blanca por entorno. En producción, el dominio web configurado en
`ALLOWED_ORIGINS`; fuera de producción, además los orígenes de desarrollo de
Angular y los esquemas nativos de Capacitor e Ionic.

**Desviación deliberada respecto del ejemplo del Plan §3.2.** El ejemplo decide
así:

```js
if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production')
```

Esa segunda condición permite **cualquier** origen fuera de producción, con
`credentials: true`. En la máquina de cualquiera del equipo o en un entorno de
pruebas desplegado, una web maliciosa podría lanzar peticiones autenticadas y
leer la respuesta. Aquí la lista blanca rige en todos los entornos; lo que cambia
entre ellos es su contenido, no si se respeta.

Un origen rechazado responde **sin** la cabecera `Access-Control-Allow-Origin`,
no con un error: lanzar convertía la respuesta en un 500, que es una excepción
sin manejar. Omitir la cabecera es además el mecanismo real, porque CORS lo hace
cumplir el navegador.

### 5.5 Límites de peticiones

Tres capas respaldadas por Redis:

| Capa | Límite | Dónde |
|---|---|---|
| Por IP | 100/min | Aplicación (y borde, en producción) |
| Por usuario | 200/min | Aplicación |
| Inicio de sesión | 10/min | `@LimiteLogin()` |
| Entrega de ejercicio | 5 cada 5 min | `@LimiteEntrega()` |

El almacén es Redis y no memoria porque los contadores deben ser compartidos:
con varias instancias, un límite en memoria se multiplica por el número de
procesos y deja de limitar.

Al superar un límite se responde **429** con `Retry-After` y se registra el
evento en formato estructurado, que es lo que alimenta la alerta de *rate limit
excedido consistentemente* del Plan §9.2.

### 5.6 Prompt injection

El núcleo del producto evalúa texto escrito por el candidato con un modelo de
lenguaje. **No existe entrada de confianza**: el enunciado, el archivo adjunto y
la respuesta son todos entrada de usuario que termina llegando al modelo.

Jerarquía inviolable: `instrucciones del sistema → configuración → datos del
usuario`. El contenido de usuario nunca modifica instrucciones privilegiadas.

> **Pendiente**: es el paquete 4.2 y todavía no está implementado.

### 5.7 Aislamiento por empresa

El criterio de aceptación del paquete 5.1 exige que **ningún reporte muestre
datos de una empresa distinta a la del reclutador autenticado**. Un reporte solo
puede aislar lo que ya viene aislado, así que la frontera está en la raíz.

> **Decisión propia, no de los documentos.** Ninguno define la empresa como
> entidad: el Charter habla de «empresa cliente» y la EDT solo fija ese criterio
> de los reportes. El modelo de abajo lo decidió el equipo el 2026-09-23.

**Dónde vive.** En el esquema `autenticacion`, junto a los usuarios: la empresa
es parte de la identidad de quien entra. No se creó un séptimo módulo porque la
arquitectura aprobada en el paquete 1.4 tiene seis.

**Quién pertenece a una empresa.**

| Rol | Empresa | Por qué |
|---|---|---|
| Reclutador | Obligatoria | Sin ella no se sabría de quién es lo que crea |
| Candidato | Nunca | Es una persona externa invitada a una vacante |
| Administrador | Opcional | Con empresa, es administrador de ella; sin empresa, de la plataforma |

Las tres reglas son un `CHECK` en la base, no solo código.

**Qué queda aislado.**

- **Vacantes:** la empresa se copia del reclutador al crearla y no cambia. Dos
  reclutadores de la misma empresa llevan el mismo proceso; los de otra reciben
  404, nunca 403.
- **Banco de ejercicios:** es propiedad intelectual de la empresa. Sin esto, un
  reclutador podría asociar a su vacante un ejercicio de la competencia.
- **Entregas, evaluaciones y reportes:** heredan el aislamiento por la vacante.

**Alta de usuarios.** El registro público solo crea candidatos. Reclutadores y
administradores se crean con `POST /api/v1/empresas/{id}/usuarios`, que es el
onboarding del paquete 5.3. Un administrador de empresa solo puede crear
usuarios en la suya.

**La sesión.** El token lleva la empresa, pero quien manda es la base: el
guardia la lee en cada petición, de modo que mover a alguien de empresa surte
efecto en la sesión que ya tenía abierta.

### 5.8 Observabilidad y alertas (paquete 5.5)

**Vida y disponibilidad son dos cosas distintas**, y mezclarlas es un error
operativo conocido:

| Ruta | Qué dice | Quién la mira |
|---|---|---|
| `GET /api/salud` | El proceso sirve HTTP. No toca ninguna dependencia | El `HEALTHCHECK` del contenedor |
| `GET /api/salud/listo` | Estado de las cuatro dependencias | El balanceador, para decidir si mandar tráfico |

Si la señal de vida fallara porque la base de datos está caída, el orquestador
reiniciaría el contenedor una y otra vez sin arreglar nada.

**Las cuatro dependencias del criterio**, comprobadas en paralelo con 3 s de
tope cada una:

| Dependencia | Cómo | ¿Crítica? |
|---|---|---|
| Base de datos | `select 1` | Sí |
| Almacenamiento | `HeadBucket` | Sí |
| Cola de trabajos | Contadores en Redis | Sí |
| Servicio de IA | `GET /api/salud` con 2 s de tope | **No** |

El servicio de IA no es crítico a propósito: sin él se siguen recibiendo
entregas y la cola las evalúa cuando vuelva. Marcarlo crítico apagaría el
backend entero por algo de lo que el candidato no depende para entregar. Con una
dependencia crítica caída, `/listo` devuelve **503**; si solo falla algo no
crítico, **200** con estado `degradado`. El cuerpo lleva siempre el detalle por
dependencia, también en el 503: es lo que convierte una alerta en un
diagnóstico.

**Cada parte registra su propia comprobación** al arrancar. El servicio de salud
vive en `common` y las fronteras del monolito le prohíben importar módulos de
negocio: si el comprobador de la cola viviera ahí, `common` tendría que conocer
el módulo de evaluación, y la regla que sostiene la arquitectura se habría roto
por una pantalla de monitorización.

**Alertas por correo** (canal elegido por el equipo), con dos decisiones:

1. **Umbral, no cada evento.** Un fallo de login es la vida normal de cualquier
   sistema; avisar de cada uno garantiza que nadie lea los avisos.
2. **Silencio tras avisar.** Un ataque genera miles de eventos y, sin freno,
   miles de correos. Tras un aviso, esa regla y esa clave callan un rato, y el
   siguiente correo dice cuántas veces pasó mientras callaba.

| Evento | Dispara con | Silencio |
|---|---|---|
| Fallos de autenticación | 5 en 5 min | 15 min |
| Rate limit excedido | 10 en 5 min | 15 min |
| Intento de inyección (riesgo alto) | 1, de inmediato | 5 min |

**Se cuenta por usuario cuando hay sesión, y por IP cuando no.** Contar los
fallos de todo el mundo en un solo contador haría que una oficina entera
disparara la alerta de una sola persona.

**Los 401 y los 429 se publican desde el filtro global de excepciones**, no
desde cada guardia: ese filtro ve todas las respuestas de error con su IP, su
ruta y su usuario, así que un origen nuevo de 401 queda cubierto sin tocar nada.
Los intentos de inyección los publica el módulo de evaluación al persistir.

**Sin SMTP configurado el proceso arranca igual**: la alerta se registra con un
aviso de que no hay canal. Un entorno de desarrollo sin credenciales tiene que
poder arrancar, y uno de producción sin canal tiene que decirlo en voz alta.

**Límite conocido:** los contadores de las alertas viven en memoria. Con varias
instancias, cada una cuenta las suyas y los umbrales se alcanzan más tarde.
Llevarlos a Redis es el paso natural; queda escrito antes que resuelto a medias.

## 6. Configuración

Toda la configuración vive fuera del código, en variables de entorno, con
`.env.example` como plantilla de valores ficticios.

**Se valida al arrancar y el proceso no levanta si algo falta o viene mal.** Es
preferible un fallo ruidoso en el arranque a descubrir a mitad de una petición
que la contraseña de la base de datos venía vacía.

```
Configuracion de entorno invalida. Revisa tu .env:
  - ENCRYPTION_KEY debe ser de 64 caracteres hexadecimales (32 bytes)
```

Los secretos **nunca** van a Git: `.gitignore` bloquea `.env`, `*.pem` y `*.key`.

### 6.1 Excepciones de dependencias, y por qué son dos y no una global

El proyecto tenía `legacy-peer-deps=true` en un `.npmrc`, puesto porque
`@nestjs/throttler` 6.5 no declaraba soporte para NestJS 12. Esa bandera
**relaja la comprobación de peers en todo el proyecto**, así que una
incompatibilidad real de cualquier otro paquete pasaba sin aviso. El propio
comentario del archivo decía que había que quitarla en cuanto se pudiera.

Se quitó. `@nestjs/throttler` 6.7.1 ya declara `^12.0.0`, y al quitarla
aparecieron **dos conflictos que la bandera estaba tapando**:

| Paquete | Qué pide | Por qué se puede forzar |
|---|---|---|
| `@nest-lab/throttler-storage-redis` 1.2.0 | NestJS ≤ 11 | Es la última versión publicada y usa solo la API de `ThrottlerStorage`, estable entre la 11 y la 12. No hay alternativa publicada. |
| `typeorm` 1.1.1 | `ioredis` 5 | Ese peer es para la **caché de consultas de TypeORM, que el proyecto no usa**: el `cache: true` del `app.module` es del `ConfigModule` y cachea variables de entorno, no consultas. |

Las dos quedan como `overrides` **acotados a esos paquetes** en `package.json`.
La diferencia con la bandera global es la que importa: si mañana otra
dependencia declara una incompatibilidad real, `npm ci` lo dice en vez de
callarse.

**Si `@nest-lab/throttler-storage-redis` publica una versión que soporte NestJS
12, su override sobra.** Y si alguna vez se activa la caché de consultas de
TypeORM, hay que revisar el de `ioredis` antes, porque entonces el peer sí
aplica.

## 7. Entorno local

```bash
cp .env.example .env      # rellenar las dos contraseñas y ENCRYPTION_KEY
docker compose up -d
npm run migration:run
npm run doctor            # comprueba que todo responde
```

Cuatro servicios separados: backend, PostgreSQL, Redis y el almacenamiento de objetos.

**Los puertos publicados están en un rango propio** (15432, 16379, 19000,
19001) y no en los de cada producto, y por debajo de 49152: de ahí para arriba
Windows reserva bloques distintos en cada reinicio. Una instalación de PostgreSQL en el sistema
se queda con el 5432 y las conexiones acaban en ella en lugar de en el
contenedor, fallando con un error de contraseña que no apunta a la causa.
`npm run doctor` detecta exactamente ese caso.

## 8. Documentación de la API

Se genera **desde el código**, nunca a mano:

```bash
npm run openapi:export    # escribe docs/openapi.json
npm run openapi:check     # falla si no corresponde al código
```

La interfaz navegable está en `/api/docs` fuera de producción; en producción se
decide con `SWAGGER_UI_ENABLED`. El fichero generado se versiona para que un
cambio en la API aparezca en el diff de la revisión por pares.

## 9. Decisiones y por qué

| Decisión | Motivo | Fuente |
|---|---|---|
| Monolito modular | Equipo pequeño, sin necesidad de despliegue independiente | Planteamiento de arquitectura |
| Servicio de IA aparte | Picos de cómputo, latencia alta, proveedor externo | Planteamiento de arquitectura |
| Evaluación asíncrona por cola | La petición del candidato no espera al modelo | Planteamiento de arquitectura |
| PostgreSQL, esquema por módulo | Aislamiento lógico y migraciones independientes | Planteamiento de arquitectura |
| REST versionada + OpenAPI | Coste bajo y valor inmediato para mostrar el producto | Planteamiento de arquitectura |
| PASETO sobre JWT | Sin algoritmos inseguros ni opciones mal configurables | Plan de Seguridad §2.1 |
| AES-256-GCM | Autentica integridad además de cifrar | Plan de Seguridad §5.2 |
| Redis para los límites | Contadores compartidos entre instancias | Plan de Seguridad §4.2 |
| Debian slim, no Alpine | `argon2` y `bcrypt` fallan con musl | Decisión técnica, este documento §5.1 |
| Lista blanca CORS en todo entorno | El ejemplo del Plan abre CORS fuera de producción | Desviación, §5.4 |
| ESLint en vez de oxlint | El encuadre lo exige y lo incluye en los criterios | Encuadre del proyecto |

## 10. Contradicciones y divergencias abiertas

**Frontend: Next.js o Angular.** El *Project Charter* (v1.0, aprobado) dice
Next.js. El *Plan de Seguridad* (v1.0, aprobado) dedica su §7 entero a Angular y
a la APK generada con Capacitor, y la EDT le asigna los paquetes 3.1 y 3.2.

Se trabaja sobre **Angular + Capacitor**, que es lo único que conserva la APK en
el alcance: el Charter y el planteamiento de arquitectura no mencionan
aplicación móvil en ningún punto, mientras que el Plan y la EDT sí.

**El Charter queda desactualizado en ese punto y el equipo debería corregirlo
formalmente.** Afecta al backend en la lista de orígenes CORS y en el transporte
del token.

**Almacenamiento de objetos: el Blueprint dice MinIO y ya no se puede.** MinIO
borró `minio/minio` y `minio/mc` de Docker Hub el **11 de septiembre de 2026**.
Su documentación remite a quay.io, pero allí la imagen exige cuenta: devuelve
401 incluso pidiendo un token anónimo. En una máquina con la imagen en caché
todo seguía funcionando, así que el problema solo apareció al mirar la
integración continua, donde no hay caché.

Se midieron los sustitutos **contra las 14 pruebas de almacenamiento del
proyecto**, no contra su folleto:

| Imagen | Resultado | Decisión |
|---|---|---|
| `adobe/s3mock` | no valida firmas | descartada sin probar: volvería verde y mentirosa la prueba del enlace prefirmado alterado |
| `localstack/localstack:4` | **11 de 14** | sirve objetos sin firma —200 donde debe dar 403— y da el *bucket* por público |
| `zenko/cloudserver` | 14 de 14 y las 184 de integración | imagen sin actualizar desde el 22/04/2022 |
| `chrislusf/seaweedfs:4.48` | 14 de 14 y las 184 de integración | **elegida**: release del 28/09/2026, mantenida y con versión fijable |

**Producción no cambia**: la aplicación habla S3 por el SDK de AWS, así que allá
puede seguir MinIO con licencia o S3 de verdad. Lo que cambia es el contenedor
de desarrollo y de CI. **El Blueprint queda desactualizado en este punto y el
equipo debería corregirlo**, o decidir pagar MinIO si quiere que dev y
producción usen el mismo servidor.

**Esquema de reportes.** El *Diccionario de la EDT* lista "esquema de reportes"
entre los recursos del paquete 5.1. El módulo se implementó **sin esquema
propio**, porque no es dueño de ningún dato y una copia de las notas se
desincroniza. El razonamiento está en §3.1.5. **Si el equipo quiere conservar el
documento tal como está, hay que decidirlo explícitamente**, no dejar que el
código y el diccionario digan cosas distintas.

**Qué intento puntúa en el ranking.** Ningún documento lo define. El código toma
el mejor intento de cada candidato, y el porqué está en §3.1.5. Es una decisión
de producto y le corresponde a la **Declaración de Alcance**.

## 11. Lo que todavía no existe

Esta tabla se actualiza al cerrar cada paquete. Lo que no aparece aquí y sí en
el Diccionario de la EDT, está construido y probado.

| Paquete | Qué falta | Responsable |
|---|---|---|
| 3.1 – 3.2 | Frontend Angular y la APK con Capacitor | Laura Alejandra Venegas Pirabán |
| 4.3 | Calibración de las rúbricas con entregas de referencia | Juana Lozano Chaves |
| 5.2 | Documentación técnica del paquete (el contrato OpenAPI ya se genera) | Hildebrando Peña Quezada |
| 5.3 | Onboarding del cliente piloto | Hildebrando Peña Quezada |
| 5.4 | Manual de uso básico | Laura Alejandra Venegas Pirabán |
| 5.6 | Operación del piloto y reporte de resultados | Hildebrando Peña Quezada |

Y dentro del backend, tres cosas concretas:

- **Extracción de texto de PDF.** Hoy se leen los archivos de texto del `.zip`;
  un PDF se rechaza con un motivo claro en vez de evaluarse a medias.
- **Pruebas de carga.** El Plan de Seguridad fija objetivos de latencia y
  concurrencia que todavía no se han medido.
- **Contadores de alertas en Redis.** Ahora viven en memoria, así que con varias
  instancias cada una cuenta las suyas (§5.8).

También falta localizar la **Declaración de Alcance v1.0**, que la EDT cita como
fuente de las funcionalidades por módulo y de los criterios de aceptación.
