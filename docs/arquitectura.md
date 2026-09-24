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
   APK Capacitor  ─┘             (monolito)       ─→  S3 / MinIO   (entregas, evidencias)
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

## 4. Datos

**PostgreSQL, un clúster, un esquema por módulo.** No hay un `public`
compartido. Da aislamiento lógico real desde el principio, evita choques de
nombres y deja que las migraciones de cada módulo avancen por separado.

**Los binarios no van a la base de datos.** Las entregas de los candidatos y las
evidencias de evaluación viven en almacenamiento de objetos compatible con S3
(MinIO en local).

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

## 7. Entorno local

```bash
cp .env.example .env      # rellenar las dos contraseñas y ENCRYPTION_KEY
docker compose up -d
npm run migration:run
npm run doctor            # comprueba que todo responde
```

Cuatro servicios separados: backend, PostgreSQL, Redis y MinIO.

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

## 10. Contradicción abierta entre documentos

**Frontend: Next.js o Angular.** El *Project Charter* (v1.0, aprobado) dice
Next.js. El *Plan de Seguridad* (v1.0, aprobado) dedica su §7 entero a Angular y
a la APK generada con Capacitor, y la EDT le asigna los paquetes 3.1 y 3.2.

Se trabaja sobre **Angular + Capacitor**, que es lo único que conserva la APK en
el alcance: el Charter y el planteamiento de arquitectura no mencionan
aplicación móvil en ningún punto, mientras que el Plan y la EDT sí.

**El Charter queda desactualizado en ese punto y el equipo debería corregirlo
formalmente.** Afecta al backend en la lista de orígenes CORS y en el transporte
del token.

## 11. Lo que todavía no existe

| Paquete | Qué falta | Responsable |
|---|---|---|
| 2.1 | Módulo de autenticación (PASETO, roles) | Anderson Fabián García Nieto |
| 2.2 | CRUD de vacantes | — |
| 2.3 | Banco de ejercicios | — |
| 2.4 | API versionada, DTOs y filtro global de excepciones | Anderson Fabián García Nieto |
| 3.3 | Almacenamiento de objetos | Daniel Eduardo Useche Pinilla |
| 4.2 | Filtros anti *prompt injection* | — |
| 4.3 – 4.5 | Rúbricas, servicio de IA y orquestación | — |
| 5.5 | Observabilidad y *health check* | Daniel Eduardo Useche Pinilla |

También falta localizar la **Declaración de Alcance v1.0**, que la EDT cita como
fuente de las funcionalidades por módulo y de los criterios de aceptación.
