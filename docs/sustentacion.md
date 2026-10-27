# Sustentación y entrega — noviembre de 2026

## 0. De dónde sale este documento, y qué vale

El insumo son **notas de Anderson García por WhatsApp del 26/10/2026** sobre lo
que el profesor dijo en el review. No es una rúbrica escrita, no es un documento
del profesor y no viene con pesos ni con criterios de aprobación: son apuntes de
segunda mano, varios de ellos frases sueltas —«lo mejor de devops», «cuánto vale
nuestra empresa con esta idea»— que son **temas**, no criterios evaluables.

Este documento los ordena y los cruza contra lo que el repositorio ya puede
sostener. Donde la nota no alcanza para saber qué se está pidiendo, **queda
dicho en vez de rellenado**. Si aparece la rúbrica real, manda la rúbrica.

## 1. Calendario, tal como lo dicen las notas

| Cuándo | Qué |
|---|---|
| Todas las semanas | Sustentación de media hora, con avances **de producto** |
| Última semana de noviembre | Presentación del proyecto |
| En la presentación | **Dos** sustentaciones distintas: una en aula máxima y una técnica |

Hoy es **26/10/2026**. Quedan **cuatro semanas** y, si la cadencia semanal
empieza ya, **cuatro sustentaciones de media hora** antes de la final.

Las dos sustentaciones finales no son la misma charla con otra ropa. La de aula
máxima responde *por qué este producto existe y cuánto vale*; la técnica
responde *por qué esta arquitectura y no otra*. El repositorio solo puede
alimentar la segunda, y hoy la alimenta a medias: la razón de cada decisión está
escrita, pero **dispersa en comentarios de código**, que no se proyecta.

## 2. Lo que se pide, contra lo que hay

| # | Lo que piden las notas | Con qué se responde hoy | Qué falta |
|---|---|---|---|
| 1 | Criterios / atributos de calidad | `docs/requisitos.md`: 21 RNF con estado honesto. Rendimiento **medido**, no estimado: 79 pet/s sanas, p95 83 ms, punto de caída en 50 it/s (`docs/rendimiento.md`) | Re-medir RNF-REN-4 tras el control de admisión, y el *soak* de horas (RNF-REN-6) |
| 2 | Cómo trabajar en equipo | Trabajo por paquetes de la EDT; PR con cinco verificaciones en CI; 450 pruebas; commits con coautoría real | Una definición de «listo» por paquete, y **quién sustenta qué** |
| 3 | Alinearse con los objetivos del proyecto | Cada paquete se cierra contra los criterios de aceptación del Diccionario de la EDT | La Declaración de Alcance sigue en **borrador sin ratificar** |
| 4 | Cómo se dio solución mediante la tecnología | `docs/arquitectura.md` (44 KB, por módulo) | Nada grave: es lo mejor cubierto |
| 5 | Cómo se cumplen los **objetivos de negocio** y los atributos de calidad | Parcial | **El hueco más grande.** No existe el mapeo objetivo de negocio → atributo de calidad → medida. Hoy se puede *afirmar* que el sistema es rápido y aislado; no se puede mostrar en una tabla que eso sirve a un objetivo del negocio |
| 6 | **Por qué esa arquitectura y no otra** | La razón de cada decisión está en el código y en `arquitectura.md` | Un documento de decisiones proyectable: `docs/adr/` |
| 7 | Cuáles son los fuertes | Ver §3 | Elegir **tres**, no doce |
| 8 | Plan de actualización tecnológica: el monolito y cómo cambia con el tiempo | La arquitectura ya es un **monolito modular** con fronteras verificadas por ESLint y un esquema de base por módulo, que es justo lo que hace posible partirlo después | El plan con **disparadores medidos**: a qué número se parte qué. Va en `docs/evolucion-tecnologica.md` |
| 9 | Lo mejor de DevOps | CI con Gitleaks, `npm audit`, lint/build/contrato, pruebas con cobertura y SonarQube; acciones ancladas por SHA; Dependabot; entorno local de un comando | **No hay despliegue.** No existe entorno desplegado ni CD. Es lo que más se nota en una sustentación de DevOps |
| 10 | Lo mejor del negocio, emprendimiento, producto, **cuánto vale la empresa** | Nada desde el backend | No es trabajo de backend. Lo único que el repositorio puede aportar son **los datos** que sostengan la cifra, y para eso hace falta el punto 11 |
| 11 | Qué **tipo** de empresas y de convocatorias; cuántas convocatorias al año por empresa (ej.: sector financiero) | Nada | **Toca el modelo de datos.** `Empresa` solo tiene nombre y si está activa. Sin `sector` esa pregunta se responde en una diapositiva, no con el sistema |
| 12 | Gestión de la oferta | Vacantes con estados y transiciones auditables | Lo que pide la pantalla A02: avance, cierre estimado, número de finalistas |
| 13 | Búsqueda de empleo **en celular**, prueba técnica **en computador** | Nada explícito | Es un requisito de dispositivo, y choca de frente con §6.2 de la matriz: aquí **no hay descubrimiento de vacantes**, solo invitación. Buscar empleo en el celular supone un catálogo que el backend no tiene |
| 14 | Producto de **marca blanca**: uno lo configura y se adapta a la empresa | La multiempresa ya es la base: aislamiento total de datos, probado | Marca blanca es **configuración por empresa** (logo, colores, dominio, textos). No existe, y es ampliación de alcance |
| 15 | Las **dos fuentes de ingresos** | Nada | Todo el cobro está marcado ⛔ en la matriz. Las dos que el producto insinúa: pago por convocatoria (A04) y suscripción al banco de retos (A10) |

## 3. Los fuertes que yo defendería en la sustentación técnica

De todo lo construido, lo que distingue a este backend de un CRUD con IA
encima son cinco cosas, y conviene llevar **tres**:

1. **El anonimato es real y deja rastro.** El ranking sale con alias; ver el
   nombre de un candidato es una acción aparte que se registra en una tabla con
   quién miró, a quién y cuándo. Si el guardado falla, la identidad no sale. Un
   producto que promete reducir sesgo y entrega nombres en la primera pantalla
   no cumple su propia promesa.
2. **La rúbrica es inmutable y versionada.** La nota dice contra qué versión de
   la rúbrica se calificó, y los ejercicios de una vacante no se pueden cambiar
   después de publicarla: si se pudieran, dos candidatos del mismo proceso
   resolverían pruebas distintas y sus notas dejarían de ser comparables. Eso es
   lo que hace defendible un resultado si alguien lo disputa.
3. **El rendimiento está medido, con punto de caída conocido.** 79 pet/s sanas,
   caída a 50 it/s, y el diagnóstico real: no había una consulta lenta que
   optimizar, había **siete núcleos sin usar**. Pocos proyectos de curso pueden
   decir dónde se rompen.
4. **El aislamiento entre empresas se prueba, no se afirma.** Pedir un recurso
   de otra empresa responde **404 y no 403**: un 403 confirma que el recurso
   existe, y con eso se puede inventariar la competencia probando
   identificadores.
5. **La IA no toca archivos que no se pueden confiar.** La extracción de texto
   vive en el backend; el servicio de IA recibe texto ya extraído. Un
   `.zip` malicioso no llega al proceso que habla con el modelo.

## 4. Lo que esto cambia en el backend

Separado en lo que **sí** es trabajo de backend y lo que no, porque mezclarlo es
cómo se llega a diciembre con diapositivas y sin producto.

**Entra al MVP ahora** (el equipo ya aprobó el MVP de diez pantallas de
`matriz-pantallas.md` §8):

- `sector` y `nit` en `Empresa` — sin eso, el punto 11 no tiene respuesta.
- El mapeo objetivo de negocio → atributo de calidad → medida, para el punto 5.
- `docs/adr/` con las decisiones y las alternativas descartadas, para el punto 6.
- `docs/evolucion-tecnologica.md` con disparadores medidos, para el punto 8.

**No entra, y hay que decidirlo antes de que alguien lo programe:**

- Marca blanca (punto 14): es configuración por empresa, y toca todas las
  pantallas. Si se quiere para la presentación, se decide esta semana.
- Descubrimiento de vacantes desde el celular (punto 13): cambia el modelo del
  producto, de invitación a catálogo. Está anotado como contradicción §6.2.
- Las dos fuentes de ingreso (punto 15): es la Declaración de Alcance, no código.

**Lo que ninguna cantidad de backend arregla:** el repositorio `web` está
**vacío** —se creó el 10/09/2026 y nunca se le subió nada— y no hay entorno
desplegado. Quedan cuatro semanas. La sustentación de aula máxima se hace con
producto a la vista, y hoy el producto solo se ve por `curl` y por Swagger.

## 5. Lo que no se puede responder desde este repositorio

Queda dicho para que nadie lo espere de aquí:

- **Cuánto vale la empresa con esta idea.** Es una valoración, y necesita
  mercado, costos y proyección de ingresos. No sale del código.
- **Qué tipo de empresas y cuántas convocatorias tienen al año.** Es un dato de
  mercado. El backend puede *guardarlo* y *contarlo* una vez exista el campo
  `sector`; no puede inventarlo.
- **Quién sustenta qué**, y si la sustentación técnica la da una persona o el
  equipo. Es una decisión del equipo.
