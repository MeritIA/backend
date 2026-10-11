# Fase 1 — Resumen de comprensión

La Fase 1 del encuadre nunca se recibió explícitamente (se pasó de la sección 18
a la Fase 2). El checklist de análisis previo pide, en su último punto,
*entregar un resumen de comprensión antes de cambios estructurales importantes*.
Esto es ese resumen, reconstruido con lo que sí llegó: las 23 secciones del
prompt, el Diccionario de la EDT, el Plan de Seguridad v1.0 y el código ya
escrito.

Se escribe **después** de construir, no antes, porque el backend ya existe. No
pretende ser lo que se pensó antes de empezar, sino lo que se entiende hoy con
el proyecto en la mano. Donde algo no está en los documentos, se dice.

## 1. Qué es MeritIA

Una plataforma para **evaluar candidatos por lo que hacen, no por su CV**: el
candidato resuelve un ejercicio práctico y la IA lo califica contra una rúbrica.
El objetivo declarado (sección 2) es reducir la dependencia del CV tradicional y
**minimizar sesgos**. Ese es todo el alcance conceptual confirmado; no se asume
nada más.

La promesa de imparcialidad tiene una consecuencia técnica que atraviesa el
diseño: si la misma entrega pudiera dar dos notas distintas, la promesa se
rompe. De ahí la idempotencia de la evaluación (una entrega, una evaluación) y
que la nota la calcule el servidor y no el modelo.

## 2. Casos de uso (checklist, punto 5)

Tres roles, que son los del Plan de Seguridad §2, y nada más:

| Rol | Qué hace |
|---|---|
| **Candidato** | Ve las vacantes a las que fue invitado, entrega su solución (con un número limitado de intentos), consulta su nota y el desglose |
| **Reclutador** | Crea vacantes y ejercicios con su rúbrica, invita candidatos, consulta el ranking y el detalle de su empresa |
| **Administrador** | Lo del reclutador sin frontera de empresa, más la cola de evaluación y el reintento de evaluaciones fallidas |

El flujo central, de punta a punta: el reclutador **crea** un ejercicio con
rúbrica y una vacante, **invita** candidatos; el candidato **entrega** un
archivo; el sistema lo **encola**, extrae el texto, lo manda al servicio de IA,
**persiste** la calificación; el reclutador **consulta** el reporte consolidado.

## 3. Restricciones (punto 6)

- **Stack cerrado:** Node + NestJS + TypeScript, PostgreSQL, monolito modular.
  No es una elección abierta: lo fija la propuesta tecnológica.
- **El servicio de IA es un componente separado** desde el día uno, hablado solo
  por cola, sin acceso a la base ni al backend. Es restricción de seguridad, no
  de arquitectura.
- **Seguridad ya decidida y aprobada** en el Plan v1.0: PASETO sobre JWT, tres
  capas de rate limiting, CORS por tipo de cliente. No se reinventa.
- **Proyecto académico calificado con auditoría externa comprometida** antes del
  piloto. El auditor no es hipotético.
- **Multi-tenancy por empresa:** ningún dato de una empresa es visible para
  otra, y eso se comprueba, no se asume.

## 4. Requisitos de seguridad (punto 7)

El detalle está en el Plan de Seguridad y en `arquitectura.md §5`. Lo que define
la forma del backend:

- **Autorización en tres niveles** — endpoint, recurso y operación. Cambiar un
  identificador en la petición nunca puede dar acceso (IDOR/BOLA). A un recurso
  ajeno se responde 404, no 403.
- **Todo contenido de usuario es dato hostil**, incluidos el enunciado, el
  archivo y la respuesta del candidato, que llegan al modelo. No hay entrada de
  confianza.
- **Cifrado en reposo** de los datos personales (AES-256-GCM), correo con hash
  de búsqueda, binarios fuera de la base.

## 5. Requisitos de rendimiento (punto 8)

**No existían en ningún documento.** Se derivaron midiendo (sección 11 del
encuadre) y viven en [`rendimiento.md`](rendimiento.md): capacidad sana de
~79 peticiones/s en una instancia, p95 por operación, y el requisito —hoy
incumplido— de rechazar explícitamente al pasar el límite en vez de ahogarse.

## 6. Integraciones (punto 9)

| Integración | Para qué | Cómo se aísla el riesgo |
|---|---|---|
| **Servicio de IA (Gemini)** | Calificar | Componente separado, por cola, sin credenciales del backend |
| **PostgreSQL** | Persistencia | Un esquema por módulo, sin claves foráneas entre esquemas |
| **Redis** | Cola y rate limiting | — |
| **Almacenamiento S3** | Archivos de entrega | Presigned URLs, bucket privado comprobado |
| **Correo (SMTP)** | Alertas de seguridad | Opcional: sin él, la alerta se registra y el proceso arranca igual |

## 7. Incertidumbres (punto 10)

Las que siguen abiertas, con su impacto:

1. **No hay documento de requisitos funcionales y no funcionales propio.** Es el
   insumo de la matriz de trazabilidad y de la primera casilla de la definición
   de terminado. Este documento y [`requisitos.md`](requisitos.md) lo
   reconstruyen desde el Diccionario de la EDT y el código, pero reconstruir no
   es lo mismo que tener el original aprobado.
2. **La Declaración de Alcance v1.0 no se ha localizado.** El Diccionario la cita
   como fuente de las funcionalidades por módulo. Decisiones que le corresponden
   —como cuál intento puntúa en el ranking— quedaron tomadas y anotadas para
   cuando aparezca.
3. **Contradicción Charter vs Plan de Seguridad** sobre el frontend (Next.js vs
   Angular). Se trabaja sobre Angular, que es lo que conserva la APK en alcance.
   Documentada en `arquitectura.md §10`.
4. **El alcance del red team no tiene umbral.** "Se intentaron explotar
   vulnerabilidades" no es cerrable sin acordar qué superficies y cuánto.

## 8. Lo que este resumen no puede afirmar

Que "los requisitos de los documentos están implementados" (primera casilla de
la sección 22) es **inverificable hoy**, porque el documento de requisitos no
está. Lo honesto es decir qué se implementó contra el Diccionario de la EDT —que
sí se tiene— y dejar la casilla abierta hasta que aparezca el documento que
menciona.
