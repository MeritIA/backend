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
