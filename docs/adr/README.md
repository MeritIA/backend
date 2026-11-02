# Decisiones de arquitectura (ADR)

Una decisión por archivo: **qué se decidió, qué se descartó y qué cuesta**.

Existen porque el review del 26/10 pide sustentar «por qué esa arquitectura y no
otra». La razón de cada decisión ya estaba escrita —en comentarios de código, y
son buenos comentarios—, pero un comentario dentro de `vacantes.service.ts` no
se puede proyectar en un aula. Esto es lo mismo, en un sitio donde se lee de
corrido.

Cada ADR dice también lo que la decisión **cuesta**. Una decisión sin
consecuencias malas no es una decisión, es publicidad.

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-monolito-modular.md) | Monolito modular, no microservicios | Vigente |
| [0002](0002-un-esquema-por-modulo.md) | Un esquema de PostgreSQL por módulo, sin claves foráneas entre ellos | Vigente |
| [0003](0003-postgresql-unica-base.md) | PostgreSQL como única base de datos | Vigente |
| [0004](0004-rest-con-openapi.md) | REST con contrato OpenAPI, no GraphQL | Vigente |
| [0005](0005-paseto-en-vez-de-jwt.md) | PASETO v4 público en vez de JWT | Vigente |
| [0006](0006-datos-personales-cifrados.md) | Datos personales cifrados en reposo, con hash para buscar | Vigente |
| [0007](0007-evaluacion-asincrona-con-cola.md) | La evaluación con IA va por cola, no en la petición | Vigente |
| [0008](0008-la-ia-no-recibe-archivos.md) | El servicio de IA es otro proceso y no recibe archivos | Vigente |
| [0009](0009-almacenamiento-compatible-s3.md) | Almacenamiento compatible con S3; SeaweedFS en desarrollo | Vigente |
| [0010](0010-reportes-sin-esquema-propio.md) | Reportes compone en vivo y no guarda una copia | Vigente, con disparador de revisión |
| [0011](0011-control-de-admision.md) | Control de admisión en el middleware, 503 antes de ahogarse | Vigente, pendiente de re-medir |
| [0012](0012-404-en-vez-de-403.md) | A un recurso ajeno se responde 404, no 403 | Vigente |
| [0013](0013-aviso-por-correo-al-cerrar.md) | Cerrar una vacante avisa por correo, y el aviso no lleva el resultado | Vigente, apagado por defecto |
| [0014](0014-registro-de-consentimientos.md) | Los consentimientos son un historial, y cada permiso dice si alguien lo hace cumplir | Vigente |
| [0015](0015-postulacion-sin-motor-de-afinidad.md) | Se puede postular a una vacante abierta; el motor de afinidad de A04 no se inventa | **Superada en parte por la 0016** |
| [0016](0016-afinidad-desde-rubricas-calificadas.md) | El % de afinidad sale de rúbricas ya calificadas, lleva cobertura y desglose, y ordena sin esconder | Vigente |
| [0017](0017-vocabulario-de-habilidades-e-invitacion-automatica.md) | Vocabulario de habilidades de plataforma, e invitación automática que solo dice sí | Vigente |

El **plan de actualización tecnológica** —cómo cambia el monolito con el tiempo,
y a qué número se parte qué— está en
[`../evolucion-tecnologica.md`](../evolucion-tecnologica.md).
