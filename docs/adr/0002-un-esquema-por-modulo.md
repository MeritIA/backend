# 0002 · Un esquema de PostgreSQL por módulo, sin claves foráneas entre ellos

**Estado:** vigente

## Contexto

Los seis módulos comparten una base. Si comparten también el espacio de nombres,
la frontera del ADR 0001 se queda en el código: nada impide que una consulta de
reportes lea `usuarios` y se acople a su forma.

## Decisión

Un esquema por módulo (`autenticacion`, `vacantes`, `ejercicios`, `entregas`,
`evaluacion`, `reportes`) y **ninguna clave foránea entre esquemas de módulos
distintos**. Lo que un módulo necesita de otro lo guarda como identificador y lo
pide por la puerta pública del otro.

## Alternativas descartadas

**Un esquema con todas las tablas.** Más cómodo, y convierte cada consulta
ingeniosa en un acoplamiento permanente.

**Claves foráneas entre esquemas.** Dan integridad referencial de verdad, que es
mucho. Se descartan porque amarran las migraciones: con una FK de `evaluacion` a
`vacantes`, las dos tablas se migran juntas y en orden, y un módulo deja de poder
avanzar sin el otro. También harían imposible mover un módulo a su propia base
sin reescribir el esquema.

## Consecuencias

A favor: cada módulo migra por su cuenta, y mover uno a otra base es cambiar una
cadena de conexión. Las fronteras se ven en la base, no solo en el código.

En contra: **la integridad entre módulos la sostiene el servicio, no el motor**.
Si un módulo borrara filas sin avisar, el otro quedaría con identificadores
colgando. Se compensa con dos cosas: nada se borra de verdad —se marca inactivo,
porque lo auditable no se tira— y el dato ausente se trata explícitamente (el
reporte muestra «Candidato no disponible» en vez de romperse).
