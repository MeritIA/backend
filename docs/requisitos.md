# Requisitos funcionales y no funcionales

**Reconstruidos, no recibidos.** No se localizó un documento propio de
requisitos (ver [`fase-1-comprension.md`](fase-1-comprension.md) §7). Esta lista
se deriva de dos fuentes que sí se tienen: el **Diccionario de la EDT** (sus
criterios de aceptación por paquete) y el **código ya implementado**. Cada
requisito apunta al paquete que lo justifica y a dónde vive en el código, que es
la matriz de trazabilidad que pide la sección 1 del encuadre.

La columna **Estado** dice la verdad medible: `implementado` solo si existe y
tiene prueba; `parcial` o `pendiente` cuando no. No se marca nada como hecho sin
respaldo.

## Requisitos funcionales

### RF-AUTH — Autenticación e identidad (paquete 2.1)

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-AUTH-1 | Un visitante se registra como candidato con correo, contraseña y nombre | `autenticacion.service · registrar` | implementado |
| RF-AUTH-2 | La contraseña se guarda con hash argon2id, nunca en claro | `contrasenas.service` | implementado |
| RF-AUTH-3 | El correo se cifra en reposo y se busca por un hash SHA-256 | `usuario.entity · columnaCifrada`, `correo_hash` | implementado |
| RF-AUTH-4 | El inicio de sesión emite un token PASETO v4 de acceso y uno de renovación | `paseto.service` | implementado |
| RF-AUTH-5 | El cliente web recibe el token en cookie HttpOnly; la APK, en el cuerpo | `tipo-cliente`, prueba `tokens-httponly` | implementado |
| RF-AUTH-6 | Desactivar una cuenta invalida sus tokens aunque sigan criptográficamente válidos | `usuarioDeToken`, `tokensValidosDesde` | implementado |
| RF-AUTH-7 | Solo un administrador promueve roles; el registro público solo crea candidatos | matriz `PERMISOS` | implementado |

### RF-EMP — Empresas y aislamiento (base del criterio 5.1 y Plan §2)

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-EMP-1 | Cada usuario no-candidato pertenece a una empresa | `usuario.idEmpresa`, `empresa.entity` | implementado |
| RF-EMP-2 | Ningún recurso de una empresa es visible para otra; a lo ajeno se responde 404 | pruebas de aislamiento en cada módulo | implementado |
| RF-EMP-3 | Cada empresa se clasifica por **sector** de una lista cerrada, para poder agrupar convocatorias por tipo de empresa | `dominio/sector.ts`, pantalla A01, review 26/10 | implementado; la taxonomía **no está ratificada** (D-6) |
| RF-EMP-4 | El **NIT** es opcional, único, y si se declara se verifica su dígito | `dominio/nit.ts` con NIT públicos como caso de prueba | implementado; la validación con Cámara de Comercio queda fuera (D-7) |

### RF-VAC — Vacantes (paquete 2.2)

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-VAC-1 | El reclutador crea, edita y lista vacantes de su empresa | `vacantes.service` | implementado |
| RF-VAC-2 | Una vacante tiene un ciclo borrador → publicada → cerrada | `estado-vacante` | implementado |
| RF-VAC-3 | La lista de ejercicios de una vacante solo se cambia en borrador | `vacantes.service · reemplazarEjercicios` | implementado |
| RF-VAC-4 | El reclutador invita candidatos; sin invitación no hay acceso ni entrega | `vacante-candidato`, `candidatoTieneAcceso` | implementado |
| RF-VAC-5 | La vacante fija cuántos intentos se permiten (1 a 10) | `intentosPermitidos` | implementado |
| RF-VAC-6 | La contratación de un candidato se registra con **quién** la registró y **cuándo** | `vacante-candidato · contratadoEn`, pantalla A08 | implementado; **no notifica** a los finalistas (§6.3 de la matriz) |

### RF-EJE — Banco de ejercicios y rúbrica (paquete 2.3)

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-EJE-1 | El reclutador crea ejercicios con enunciado y una rúbrica de criterios | `ejercicios.service` | implementado |
| RF-EJE-2 | Los pesos de la rúbrica suman 100; cada criterio tiene escala y descripción | `rubrica · validarRubrica`, `PESO_TOTAL` | implementado |
| RF-EJE-3 | Editar un ejercicio versiona la rúbrica; una nota recuerda con qué versión se calificó | `ejercicio-version`, `evaluacion.idVersion` | implementado |

### RF-ENT — Entregas y control de intentos (paquete 3.4)

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-ENT-1 | El candidato entrega un archivo a una vacante publicada a la que fue invitado | `entregas.service · crear` | implementado |
| RF-ENT-2 | No se superan los intentos permitidos; el exceso se rechaza con 409 | restricción única + prueba de concurrencia | implementado |
| RF-ENT-3 | Dos envíos simultáneos no crean dos entregas del mismo número de intento | unique constraint, prueba de 10 simultáneas | implementado |
| RF-ENT-4 | El archivo se guarda en almacenamiento de objetos, no en la base | `almacenamiento.service` | implementado |
| RF-ENT-5 | Cada cambio de estado de la entrega queda en un historial | `historial-estado-entrega` | implementado |

### RF-EVA — Evaluación con IA (paquetes 4.1–4.5)

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-EVA-1 | La entrega se evalúa de forma asíncrona por una cola, no en la petición | `cola-de-evaluacion.service` (BullMQ) | implementado |
| RF-EVA-2 | El texto se extrae en el backend; el servicio de IA no procesa archivos no confiables | `extraer-texto` | implementado |
| RF-EVA-3 | Un doble envío no produce dos evaluaciones (idempotencia por idEntrega) | `jobId = idEntrega` | implementado |
| RF-EVA-4 | La calificación trae puntaje por criterio y evidencia; sin evidencia se rechaza | `validar-respuesta` (ai-service) | implementado |
| RF-EVA-5 | La nota final es la suma ponderada, calculada por el servidor y no por el modelo | `nota · calcularNotaFinal` | implementado |
| RF-EVA-6 | Un intento de inyección en la entrega se marca con riesgo graduado, no se bloquea | `deteccion-de-inyeccion` (ai-service) | implementado |
| RF-EVA-7 | Una evaluación fallida se puede reintentar sin gastar un intento del candidato | `reintentarFallida` | implementado |
| RF-EVA-8 | El candidato ve sus notas; el reclutador las de su vacante; nadie más | `evaluacion.service`, respuesta 404 | implementado |

### RF-REP — Reportes (paquete 5.1)

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-REP-1 | El reclutador consulta el ranking de una vacante, de mayor a menor nota | `reportes.service · deVacante` | implementado |
| RF-REP-2 | El ranking lleva una fila por candidato, con la nota de su mejor intento | `consolidar · rankingDeCandidatos` | implementado |
| RF-REP-3 | El detalle de un candidato muestra todos sus intentos con su desglose | `deCandidatoEnVacante` | implementado |
| RF-REP-4 | El ranking se exporta a CSV, con las celdas neutralizadas contra inyección de fórmulas | `csv · neutralizarFormula` | implementado |
| RF-REP-5 | Ningún reporte muestra datos de otra empresa | delegación en `obtenerPara`/`deVacante`, prueba | implementado |
| RF-REP-6 | El ranking dice en qué criterio destacó cada candidato | `consolidar · habilidadDestacadaDe`, pantalla A06 | implementado |
| RF-REP-7 | La empresa ve sus cifras en una sola llamada: vacantes por estado, finalistas en evaluación, contratados y retos del banco | `reportes.service · panelDeLaEmpresa`, pantalla A02 | implementado |
| RF-REP-8 | El candidato ve su puesto y el total de participantes, solo con la vacante cerrada | `evaluacion.service · miPuestoEn`, pantalla B22 | implementado (D-8) |

### RF-NOT — Avisos a los candidatos (decisión del 27/10/2026, D-10)

No sale de ningún paquete de la EDT: sale de la decisión de producto del
27/10/2026. Se escribe aquí con la misma forma que el resto para que sea
trazable igual.

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-NOT-1 | Al cerrarse una vacante se avisa por correo a cada candidato con al menos una entrega evaluada | `notificaciones.service · avisarDelCierre`, evento `vacantes.vacante-cerrada` | implementado |
| RF-NOT-2 | El aviso no contiene la calificación, ni el puesto, ni si la persona fue seleccionada, ni datos de otros participantes | `dominio/plantillas · avisoDeCierre` y sus pruebas | implementado (D-10) |
| RF-NOT-3 | Ningún candidato recibe el mismo aviso dos veces, ni por un evento repetido ni por un reenvío manual | índice único `(vacante, candidato, tipo)` + reserva en estado `enviando` | implementado |
| RF-NOT-4 | Lo que no se pudo enviar queda registrado con su motivo y se puede reintentar sin repetir lo ya enviado | `POST /notificaciones/vacantes/:id/reenviar` | implementado |
| RF-NOT-5 | El reclutador ve el estado de los avisos de su vacante, sin direcciones de correo | `GET /notificaciones/vacantes/:id` | implementado |
| RF-NOT-6 | El envío a candidatos se puede apagar sin dejar de registrar a quién había que avisar | `NOTIFICACIONES_A_CANDIDATOS` | implementado (D-11) |

### RF-OBS — Observabilidad y alertas (paquete 5.5)

| ID | Requisito | Traza | Estado |
|---|---|---|---|
| RF-OBS-1 | Señal de vida que no toca dependencias, y señal de disponibilidad que las comprueba | `salud.controller` | implementado |
| RF-OBS-2 | La caída de una dependencia crítica devuelve 503 con el detalle | `salud.service` | implementado |
| RF-OBS-3 | Fallos de autenticación, rate limit e inyección repetidos generan una alerta por correo | `alertas.service` | implementado |
| RF-OBS-4 | Cada evento de seguridad queda registrado aunque no se avise | `alertas.service · procesar` | implementado |

## Requisitos no funcionales

### RNF de seguridad (Plan de Seguridad v1.0)

| ID | Requisito | Estado |
|---|---|---|
| RNF-SEG-1 | Autorización por endpoint, recurso y operación; IDOR imposible | implementado, con pruebas de seguridad |
| RNF-SEG-2 | Datos personales cifrados en reposo; secretos fuera de Git | implementado; Gitleaks en cada push |
| RNF-SEG-3 | Rate limiting en tres capas (IP, usuario, endpoint crítico) | implementado |
| RNF-SEG-4 | Errores que no filtran stack traces, secretos ni internos | implementado |
| RNF-SEG-5 | Toda vulnerabilidad encontrada deja una prueba de regresión | práctica sostenida |
| RNF-SEG-6 | Red team interno sobre las superficies del encuadre | **parcial**: practicado, sin umbral acordado |

### RNF de calidad

| ID | Requisito | Estado |
|---|---|---|
| RNF-CAL-1 | TypeScript strict; cero `any` y cero `catch` vacíos en `src` | implementado (verificado) |
| RNF-CAL-2 | Cobertura de pruebas ≥ 80 % | implementado: 89,6 % líneas (ramas 77 %) |
| RNF-CAL-3 | Cinco niveles de prueba: unit, integración, E2E, seguridad, concurrencia | **parcial**: falta el E2E de flujo completo |
| RNF-CAL-4 | Migraciones versionadas; la base protege la integridad, no solo el código | implementado |

### RNF de rendimiento (medidos — ver [`rendimiento.md`](rendimiento.md))

| ID | Requisito | Estado |
|---|---|---|
| RNF-REN-1 | ≥ 75 pet/s sostenidas en una instancia | implementado: 79 medido |
| RNF-REN-2 | p95 en carga sana dentro de objetivo por operación | implementado |
| RNF-REN-3 | Cero respuestas inesperadas hasta el punto de caída | implementado |
| RNF-REN-4 | Rechazar explícitamente al pasar el límite (503 + Retry-After) | **pendiente**: hoy colapsa |
| RNF-REN-5 | Recuperar tras un pico en ≤ 60 s | **no medible aún** |
| RNF-REN-6 | Sin crecimiento sostenido de memoria bajo carga | **no verificado**: falta el soak |

### RNF de operación

| ID | Requisito | Estado |
|---|---|---|
| RNF-OPE-1 | El entorno local se levanta con un comando | implementado (`compose.yaml`) |
| RNF-OPE-2 | Servicios separados; imagen con usuario no-root y healthcheck | implementado |
| RNF-OPE-3 | Configuración por entorno, validada al arrancar | implementado |
| RNF-OPE-4 | Contrato OpenAPI publicado | implementado (45 operaciones) |

## Qué queda fuera, a propósito

El Diccionario lo marca como fuera de alcance del MVP, y aquí se repite para que
nadie lo pida como un hueco: analítica avanzada y métricas predictivas en los
reportes (5.1), y cualquier funcionalidad no respaldada por un documento. El
encuadre prohíbe inventarlas.
