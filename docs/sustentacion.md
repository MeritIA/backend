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
| 5 | Cómo se cumplen los **objetivos de negocio** y los atributos de calidad | El mapeo está en el **§3 de este documento**: cada objetivo con su atributo, su medida y dónde se comprueba | Dos filas de esa tabla están en amarillo, y son las que hay que poder defender |
| 6 | **Por qué esa arquitectura y no otra** | **[`adr/`](adr/)**: doce decisiones, cada una con la alternativa descartada y lo que cuesta | Nada: es lo que el punto pedía. Falta elegir **cuáles tres** se cuentan en media hora |
| 7 | Cuáles son los fuertes | Ver §4 | Elegir **tres**, no doce |
| 8 | Plan de actualización tecnológica: el monolito y cómo cambia con el tiempo | **[`evolucion-tecnologica.md`](evolucion-tecnologica.md)**: cinco etapas, cada una con su disparador medido, más el plan de dependencias | La etapa 1 no se puede empezar sin entorno desplegado (punto 9) |
| 9 | Lo mejor de DevOps | CI con Gitleaks, `npm audit`, lint/build/contrato, pruebas con cobertura y SonarQube; acciones ancladas por SHA; Dependabot; entorno local de un comando | **No hay despliegue.** No existe entorno desplegado ni CD. Es lo que más se nota en una sustentación de DevOps |
| 10 | Lo mejor del negocio, emprendimiento, producto, **cuánto vale la empresa** | Nada desde el backend | No es trabajo de backend. Lo único que el repositorio puede aportar son **los datos** que sostengan la cifra, y para eso hace falta el punto 11 |
| 11 | Qué **tipo** de empresas y de convocatorias; cuántas convocatorias al año por empresa (ej.: sector financiero) | Nada | **Toca el modelo de datos.** `Empresa` solo tiene nombre y si está activa. Sin `sector` esa pregunta se responde en una diapositiva, no con el sistema |
| 12 | Gestión de la oferta | Vacantes con estados y transiciones auditables | Lo que pide la pantalla A02: avance, cierre estimado, número de finalistas |
| 13 | Búsqueda de empleo **en celular**, prueba técnica **en computador** | Nada explícito | Es un requisito de dispositivo, y choca de frente con §6.2 de la matriz: aquí **no hay descubrimiento de vacantes**, solo invitación. Buscar empleo en el celular supone un catálogo que el backend no tiene |
| 14 | Producto de **marca blanca**: uno lo configura y se adapta a la empresa | La multiempresa ya es la base: aislamiento total de datos, probado | Marca blanca es **configuración por empresa** (logo, colores, dominio, textos). No existe, y es ampliación de alcance |
| 15 | Las **dos fuentes de ingresos** | Nada | Todo el cobro está marcado ⛔ en la matriz. Las dos que el producto insinúa: pago por convocatoria (A04) y suscripción al banco de retos (A10) |

## 3. Objetivo de negocio → atributo de calidad → medida

Esto es lo que pedía el punto 5, y es la tabla que convierte «el sistema es
bueno» en algo que se puede comprobar delante de alguien. La columna que importa
es la última: **dónde se mira para saber si es verdad**.

| Objetivo de negocio | Atributo de calidad | Medida concreta | Dónde se comprueba | Estado |
|---|---|---|---|---|
| Reducir el sesgo en la selección — es el propósito del producto | Confidencialidad | El ranking **no contiene** nombres ni correos; ver una identidad es una acción aparte y **queda registrada** con quién, a quién y cuándo | Prueba de integración que falla si un nombre aparece en el reporte; tabla `revelaciones_de_identidad` | ✅ |
| Que un resultado se pueda **defender ante una disputa** | Trazabilidad e integridad | La nota dice **contra qué versión de rúbrica** se calificó, con evidencia por criterio; los ejercicios de una vacante **no se pueden cambiar** tras publicarla | `admiteCambioDeEjercicios`, `ResumenVersion`, historial de estados de la entrega | ✅ |
| Que una empresa **nunca** vea datos de otra, que es la condición para que un cliente entre | Confidencialidad / control de acceso | A lo ajeno se responde **404 y no 403**, para no confirmar que existe; probado módulo por módulo | ADR 0012, pruebas de aislamiento en todos los módulos | ✅ |
| Evaluar más rápido y más barato que leer CVs | Rendimiento y capacidad | **79 pet/s** sostenidas con **p95 83 ms**; punto de caída conocido en 50 it/s; pasado el tope se rechaza con 503 en vez de colapsar | `rendimiento.md`, ADR 0011 | 🟡 el rechazo con 503 **está sin re-medir** |
| Que el candidato reciba algo por su trabajo, y no solo silencio | Transparencia / usabilidad | Lee el **enunciado y la rúbrica** antes de entregar, y al cerrarse el proceso ve **su puesto y el total** | `GET /vacantes/{id}/ejercicios`, `GET /evaluaciones/vacante/{id}/mi-puesto` (D-8) | ✅ |
| Que una empresa pueda operar sola sin pedirnos nada | Disponibilidad | La caída del proveedor de IA **retrasa notas, no rechaza entregas**: la cola evalúa al volver | D-2, ADR 0007, health check | ✅ |
| Que el equipo pueda seguir cambiando el producto sin romperlo | Mantenibilidad | **582 pruebas**, cobertura 89,6 % de líneas, cinco verificaciones en cada PR, fronteras entre módulos verificadas por ESLint | CI, `requisitos.md` RNF-CAL | 🟡 falta el **E2E de flujo completo** |
| Cumplir la Ley 1581 con los datos de los candidatos | Confidencialidad / cumplimiento | Correo, nombre y nombre de archivo **cifrados en reposo** (AES-256-GCM), contraseñas con argon2id, secretos fuera de Git con Gitleaks en cada push, y **consentimientos con historial** que el backend hace cumplir donde puede | ADR 0006, ADR 0014, CI | 🟡 **consentimientos hechos** (B12 y el panel de B24, con historial); faltan «descargar mis datos» y «eliminar cuenta» |

Las tres filas en amarillo son las que conviene llevar preparadas, porque son
las que un profesor que lea con atención va a preguntar.

## 4. Los fuertes que yo defendería en la sustentación técnica

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

## 5. Lo que esto cambia en el backend

Separado en lo que **sí** es trabajo de backend y lo que no, porque mezclarlo es
cómo se llega a diciembre con diapositivas y sin producto.

**Hecho el 26 y 27/10**, a partir de estas notas y del MVP de diez pantallas que
el equipo aprobó (`matriz-pantallas.md` §8):

- ✅ `sector` y `nit` en `Empresa` — sin eso, el punto 11 no tenía respuesta. El
  NIT se verifica por su dígito, que es la única comprobación posible mientras no
  exista la integración con Cámara de Comercio.
- ✅ El mapeo objetivo → atributo → medida del punto 5, en el §3 de aquí.
- ✅ [`adr/`](adr/): catorce decisiones con su alternativa descartada, para el punto 6.
- ✅ [`evolucion-tecnologica.md`](evolucion-tecnologica.md) con disparadores
  medidos, para el punto 8.
- ✅ Las cuatro pantallas del MVP que no se podían construir: el panel de la
  empresa (A02, una llamada en vez de N), la habilidad destacada del ranking
  (A06), el registro de contratación (A08) y el puesto del candidato (B22).
- ✅ **El aviso por correo al cerrar una vacante** (D-10), que era el último
  impedimento de la matriz de pantallas. Con él, las tres contradicciones que esa
  matriz encontró quedan resueltas y el front puede empezar por cualquiera de las
  diez pantallas sin esperar nada del backend.
- ✅ Ratificada la lista de catorce sectores (D-6), que estaba en el código sin
  que ningún documento la respaldara.
- ✅ **El plan y el avance de cada vacante** (D-12, D-13): «cierre estimado» y
  «finalistas a evaluar» como campos, y el «avance» de cada tarjeta de A02 en la
  misma llamada del panel —invitados, cuántas personas entregaron, cuántas tienen
  evaluación y el porcentaje—. Las dos decisiones que hubo que tomar quedaron
  escritas: el denominador son los invitados y no el plan, porque el plan se
  puede cambiar a mitad del proceso y la barra retrocedería; y el estimado **no
  cierra nada**, porque cerrar le escribe a personas reales.
- ✅ **El registro de consentimientos** (D-14, D-15, D-16): B12 y el panel
  «Privacidad de tus datos» de B24 ya tienen detrás una tabla que **solo crece**,
  porque la Ley 1581 no pide saber qué autoriza alguien hoy sino poder
  **demostrar** qué autorizó y cuándo. El backend **no los hace cumplir** y lo
  dice en la respuesta, en vez de callarlo. Al transcribir las dos pantallas
  apareció una contradicción entre ellas: §6.10 de la matriz.
- ✅ **Y uno de ellos ya se hace cumplir** (D-17, que cierra esa §6.10):
  revocar «calificación por IA» bloquea la entrega con un 403 que dice cómo
  volver atrás. Es la consecuencia honesta de que la pantalla lo muestre como
  revocable, y deja un trabajo de **diseño**: B12 lo pinta como un
  interruptor más, al lado de uno marcado «Opcional», sin advertir que
  apagarlo impide participar. El backend ya devuelve ese aviso para que la
  pantalla lo muestre antes y no después.

**Lo siguiente que sí es backend, por orden de lo que desbloquea:**

- «Descargar mis datos» y «Eliminar cuenta» de B24. **No son adorno**: son
  obligaciones de la Ley 1581 que el producto ya promete en pantalla, y hoy no
  tienen ruta. La segunda obliga a decidir qué pasa con las evaluaciones ya
  emitidas, que son el expediente del proceso de una empresa.
- El E2E de flujo completo y el *soak* de horas, que son las dos filas amarillas
  del §3.

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

## 6. Lo que no se puede responder desde este repositorio

Queda dicho para que nadie lo espere de aquí:

- **Cuánto vale la empresa con esta idea.** Es una valoración, y necesita
  mercado, costos y proyección de ingresos. No sale del código.
- **Qué tipo de empresas y cuántas convocatorias tienen al año.** Es un dato de
  mercado. El backend puede *guardarlo* y *contarlo* una vez exista el campo
  `sector`; no puede inventarlo.
- **Quién sustenta qué**, y si la sustentación técnica la da una persona o el
  equipo. Es una decisión del equipo.
