# El flujo de extremo a extremo, y qué parte existe

**De dónde sale:** del Figma del equipo, *MeritIA · Flujos end-to-end y
mockups*, página **«BPM Inteligente · MeritIA»**, contrastado con el
*Taller 2 · BPM y Wireframes*, que es la auditoría que el propio equipo le hizo
a este proceso. Leído el **28/10/2026**.

Hasta hoy ese diagrama no estaba en ningún sitio del repositorio: el backend se
construyó contra la EDT, el Plan de Seguridad y las 27 pantallas, y el proceso
que las une estaba solo en Figma. Esto lo anota, dice qué paso tiene backend y
cuál no, y nombra las dos cosas que **contradicen** la pantalla de
consentimientos.

> **Aviso sobre lo que no pude leer.** Los pasos **1 y 2** quedaron fuera del
> encuadre y no los transcribo: inventarlos sería justo lo que el encuadre del
> proyecto prohíbe. Por la numeración del resto, el proceso empieza antes del
> análisis antifraude. Quien tenga el Figma abierto que los añada aquí.

## El proceso, paso a paso

| # | Paso | Tipo | ¿Existe en el backend? |
|---|---|---|---|
| 1–2 | *(sin leer)* | — | — |
| 3 | Modelo antifraude analiza la sesión — *visión por computador + patrones de comportamiento* | IA | ⛔ No existe. Proctoring es B15/B16, sin paquete |
| 4 | Calcula probabilidad y nivel de confianza — *score de anomalía 0–100 %* | IA | ⛔ No existe |
| 5 | **¿Confianza ≥ 80 % y sin marca de riesgo?** — *umbral de decisión automático* | Compuerta | ⛔ No existe |
| — | *(rama «no»)* Agente revisa evidencia de la sesión | **Humano** | ⛔ Flujo C de moderación, sin paquete |
| 6 | Modelo de rúbrica califica la entrega — *genera el ranking de finalistas* | IA | ✅ Paquetes 4.1–4.5. **Hoy se ejecuta sin la compuerta del paso 5** |
| 7 | ¿Fraude confirmado? — *decisión humana final sobre el caso* | Compuerta | ⛔ Flujo C |
| 8 | Fin: candidato descalificado — *se notifica al candidato y a la empresa* | Fin | ⛔ |
| 9 | Mentor IA genera retroalimentación — *mensaje con recomendaciones al candidato* | IA | ⛔ B22, sin paquete. Arranca con datos **públicos** de mercado (Modelo de Negocio): hoy no necesita consentimiento propio (§6.12) |
| 10 | Empresa revisa ranking y contrata — *cierra la vacante y paga al candidato ganador* | Humano | ◐ Ranking, contratar y cerrar sí (5.1, A08). **El pago no** |
| 11 | Genera informe y auditoría de sesgo — *métricas de equidad por grupo, trazabilidad* | IA | ◐ Trazabilidad sí; **equidad por grupo no** (§6.8) |
| 12 | ¿Dispersión de pago exitosa? — *verificación con la pasarela* | Compuerta | ⛔ Todo el cobro |
| 13 | Fin: pago recibido y perfil publicado — *el candidato queda visible en el banco de talento* | Fin | ⛔. **Este paso está mal: solo se publica con permiso** (§6.11, D-18) |
| 14 | *(rama «no» del 12)* Reintento de dispersión — *revisión manual de datos bancarios* | **Humano** | ⛔ |

## Lo que este diagrama cambia respecto a lo que creíamos

**1. El umbral del antifraude es un número concreto: 80 %.** Y el Taller 2 añade que falta un **muestreo aleatorio con QA humano sobre los casos que el antifraude NO marca** (Supuesto 2), que hoy no está ni en el diagrama ni en ningún paquete.

**1-bis.** No estaba en
ningún documento del repositorio. Cuando el flujo C se construya, ese es el
valor a implementar, y conviene que entre a la Declaración de Alcance antes:
mover un umbral después de desplegarlo cambia a quién se descalifica.

**2. Evaluar es un paso *posterior* a una compuerta que no existe.** En el
diseño, la rúbrica solo califica si el antifraude pasó o si una persona
despejó el caso. Hoy el backend evalúa directo. No es un error —el antifraude
no existe— pero sí fija dónde encaja cuando llegue: **antes** de encolar la
evaluación, no después.

**3. El único paso humano del diseño revisa fraude, no califica.** Se buscó a
propósito si el diagrama ofrecía una evaluación humana alternativa, que era la
tercera salida posible de la contradicción §6.10. **No existe.** El paso 7 es
«decisión humana final sobre el caso» y mira evidencia de sesión. Eso confirma
la decisión **D-17**: ofrecer una calificación humana alterna habría sido
inventar producto.

**4. El paso 10 junta tres cosas que el backend separa**: cerrar la vacante,
contratar y pagar. El backend las tiene aparte a propósito (**D-9**: cerrar no
revela identidades ni contrata). Cuando entre el cobro habrá que decidir si esa
separación se mantiene o si el pago se dispara al contratar.

## Este diagrama no es la última palabra, y el equipo ya lo sabía

El **Taller 2 · BPM y Wireframes** es una auditoría que el propio equipo le hizo
a este proceso. Encontró tres supuestos, dos excepciones sin ruta y un riesgo
ético, y propuso **seis cambios**. El diagrama que hoy está en Figma aplicó
tres de ellos:

| Cambio propuesto en el Taller 2 | ¿Aplicado en el BPM de hoy? |
|---|---|
| Excepción 1 · conectar la rama «falso positivo» a un nodo de resolución | ✅ Sí: va al paso 9 |
| Excepción 2 · compuerta «¿pago aprobado?» con reintento | ✅ Sí: pasos 12 y 14 |
| Riesgo ético · auditoría de sesgo documentada | ✅ Sí: paso 11 |
| Supuesto 1 · verificación técnica previa y modalidad alterna sin cámara | ◐ En las pantallas B15/B16, no en el diagrama |
| Supuesto 2 · muestreo aleatorio con QA humano sobre casos **no** marcados | ⛔ No aparece |
| **Supuesto 3 · separar el consentimiento por finalidad** | ⛔ **No aparece: el paso 13 sigue publicando el perfil de todo el mundo** |

Por eso, donde el diagrama y B12 dicen cosas distintas sobre consentimiento,
**no son dos posturas en disputa: es un paso que quedó sin rehacer.**

## Las dos contradicciones con la pantalla de consentimientos, resueltas

Resueltas el 28/10 como **D-18**, con el desarrollo en
[`matriz-pantallas.md`](matriz-pantallas.md) §6.11 y §6.12. En corto:

- **§6.11 — Manda B12.** El Taller 2 marcó como defecto que un consentimiento
  único cubriera «la exposición posterior del perfil visible para otras
  empresas en el banco de talento», y resolvió separarlo en **tres finalidades
  nombradas**: biometría, calificación por IA y publicación del perfil. Son las
  tres tarjetas de B12. **Hay que corregir el paso 13**, no la pantalla.
- **§6.12 — El Mentor IA no es una finalidad documentada.** No está en esas
  tres, ni en la EDT, ni en el Charter, ni en el Plan de Seguridad. El Modelo de
  Negocio dice que arranca «con datos públicos de mercado laboral». Se retiró
  del catálogo del backend. Al panel de B24 le sobra ese interruptor y **le
  falta «Calificación por IA»**, que sí es una de las tres.

## Cómo se usa esto

No es un documento para leer una vez. Sirve para tres cosas concretas:

1. **Saber qué falta de verdad.** De los catorce pasos, el backend cubre uno
   entero (el 6) y parte de dos (10 y 11). Lo demás son pagos, moderación y
   proctoring, que ya estaban anotados como ampliación de alcance en
   [`arquitectura.md`](arquitectura.md) §10 — pero verlos en secuencia deja
   claro que son **la mitad del proceso**, no extras.
2. **Decidir qué se demuestra.** El MVP de diez pantallas
   ([`matriz-pantallas.md`](matriz-pantallas.md) §8) recorre los pasos 6, 10 y
   11 sin dinero, sin cámara y sin moderación. Es el único tramo del diagrama
   que hoy se puede enseñar funcionando de punta a punta.
3. **Ubicar cada cosa nueva.** Antes de programar algo, mirar en qué paso entra.
   Si no entra en ninguno, es alcance nuevo y va a la Declaración de Alcance.
