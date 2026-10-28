# El flujo de extremo a extremo, y qué parte existe

**De dónde sale:** del Figma del equipo, *MeritIA · Flujos end-to-end y
mockups*, página **«BPM Inteligente · MeritIA»**. Leído el **28/10/2026**.

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
| 9 | Mentor IA genera retroalimentación — *mensaje con recomendaciones al candidato* | IA | ⛔ B22, sin paquete. **Ver contradicción §6.12** |
| 10 | Empresa revisa ranking y contrata — *cierra la vacante y paga al candidato ganador* | Humano | ◐ Ranking, contratar y cerrar sí (5.1, A08). **El pago no** |
| 11 | Genera informe y auditoría de sesgo — *métricas de equidad por grupo, trazabilidad* | IA | ◐ Trazabilidad sí; **equidad por grupo no** (§6.8) |
| 12 | ¿Dispersión de pago exitosa? — *verificación con la pasarela* | Compuerta | ⛔ Todo el cobro |
| 13 | Fin: pago recibido y perfil publicado — *el candidato queda visible en el banco de talento* | Fin | ⛔. **Ver contradicción §6.11** |
| 14 | *(rama «no» del 12)* Reintento de dispersión — *revisión manual de datos bancarios* | **Humano** | ⛔ |

## Lo que este diagrama cambia respecto a lo que creíamos

**1. El umbral del antifraude es un número concreto: 80 %.** No estaba en
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

## Las dos contradicciones con la pantalla de consentimientos

Están escritas con su desarrollo en [`matriz-pantallas.md`](matriz-pantallas.md)
§6.11 y §6.12, que es donde viven todas las contradicciones de este proyecto.
En corto:

- **§6.11 — El paso 13 publica el perfil de todo el mundo.** El final feliz del
  flujo dice «el candidato queda visible en el banco de talento», sin preguntar.
  Pero B12 marca ese permiso **«Opcional» y nace apagado**. El flujo trata como
  automático algo que la pantalla presenta como una elección.
- **§6.12 — El paso 9 ejecuta el Mentor IA para todos.** Y «Datos para el
  Mentor IA» es justo el permiso que B24 deja revocar y que **B12 nunca pide**.
  El diagrama confirma que no es un descuido del mockup: el flujo da por hecho
  un tratamiento que nadie autoriza.

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
