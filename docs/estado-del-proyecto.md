# Estado del proyecto — 28 de octubre de 2026

Qué está hecho, qué falta y qué está a medias, en los tres repositorios.
Escrito para que nadie tenga que preguntar por chat si algo sirve ya.

**Regla de este documento: a medias se dice a medias.** Un ✅ aquí significa
que se puede abrir y usar hoy; un ◐ significa que hay piezas pero el caso de
uso completo no se sostiene. Lo que no existe se escribe ⛔ y no se adorna.

Quedan **cuatro semanas** hasta la presentación de la última semana de
noviembre.

---

## 1. En una tabla

| | Backend | Front (`web`) | Servicio de IA |
|---|---|---|---|
| Commits | 85 | 4 en `main`, **4 sin mergear** | 9 |
| Pruebas | **586** (288 + 298) | **ninguna** | las del 4.2 y 4.3 |
| CI | 5 verificaciones | 3 | sí |
| Imagen Docker | ✅ (arreglada hoy, PR #26) | ⛔ | ✅ |
| Desplegado | ⛔ **en ningún sitio** | ⛔ | ⛔ |

Lo más importante de esta tabla es la última fila. **Nada está desplegado.**
El código funciona en la máquina de quien lo corre, y eso es todo.

---

## 2. Backend

Siete módulos, un esquema de PostgreSQL por módulo, 47 operaciones en el
contrato, catorce ADR.

### Lo que se sostiene de punta a punta

- **Sesión y roles.** PASETO v4, contraseñas con argon2id, cookie `HttpOnly`
  para web y cuerpo para la APK. El cliente se declara, no se adivina.
- **Aislamiento entre empresas.** Un recurso de otra empresa devuelve **404 y
  no 403**: un 403 confirmaría que el identificador existe. Hay pruebas que lo
  fijan.
- **Datos personales cifrados en columna** con AES-256-GCM: correo, nombre y
  nombre de archivo.
- **Ejercicios con rúbrica versionada.** Los pesos tienen que sumar 100 y se
  valida. Una entrega guarda **con qué versión** se calificó.
- **Vacantes con estados auditables**, invitaciones, y publicar exige al menos
  un ejercicio.
- **Entregas** con validación de extensión, tamaño (25 MiB) y ritmo, a
  almacenamiento S3, y enlace firmado para descargar.
- **Evaluación con IA asíncrona**, por cola con reintentos y espera
  exponencial. Sin servicio de IA configurado entra el **evaluador honesto**:
  falla con un motivo en vez de inventar una nota.
- **Reportes:** el panel de la empresa en **una sola llamada**, el ranking con
  alias, el CSV, y el puesto del candidato cuando la vacante cierra.
- **Aviso por correo al cerrar**, imposible de duplicar por diseño de la base
  de datos, con estado por destinatario y reintento.
- **Registro de consentimientos** de la Ley 1581: cada decisión guarda qué,
  cuándo, a qué versión del aviso y desde dónde. Revocar **añade una fila**, no
  borra la anterior.
- **El consentimiento de calificación por IA se hace cumplir** (D-17):
  revocarlo bloquea la entrega con un 403 que dice cómo volver atrás.

### Lo que falta, por orden de lo que duele

1. **Todo el cobro.** ⛔ Pasarela, referencia, estado, reintento, y con él la
   remuneración al candidato. Son dos pantallas enteras del flujo (A04, A05,
   B23) y **las dos fuentes de ingresos del modelo de negocio**.
2. **`npm start` no funciona.** `nest start` no carga `.env` y el error que
   sale —`SASL: client password must be a string`— no dice lo que pasa. Quien
   clone el repositorio hoy se come eso. El rodeo está en el README.
3. **Proctoring y antifraude.** ⛔ Cámara, micrófono, sesión cronometrada del
   lado del servidor, moderación y la ruta de disputa (B15, B16, B19→B21).
4. **Descubrimiento de vacantes.** ⛔ Aquí solo se entra por invitación. «Buscar
   empleo en el celular» supone un catálogo que no existe.
5. **Ley 1581 a medias:** faltan **«Descargar mis datos»** y **«Eliminar
   cuenta»**. No son ⛔ de alcance: son obligaciones legales.
6. **`Empresa` solo tiene nombre y si está activa.** Sin `sector` no se puede
   responder «cuántas convocatorias al año por tipo de empresa», que es una de
   las preguntas del review.
7. **Nueve PR de Dependabot abiertos**, tres de ellos mayores (paseto 3→4,
   vitest 4→5, @types/node 24→26).

### Rendimiento, medido y no estimado

79 peticiones/s sanas, p95 de 83 ms, punto de caída en 50 iteraciones/s
([`rendimiento.md`](rendimiento.md)). Falta re-medir tras el control de
admisión, y el *soak* de horas.

---

## 3. Front (`web`)

Angular 22 con componentes sueltos, señales, sin zona y rutas perezosas.

**Las diez pantallas del MVP están construidas y recorridas en el navegador.**
La lista acordada es `matriz-pantallas.md` §8: A01 → A02 → A03 → A04 → A06 →
A07 → A08, y B11 → B14 → B17 → B22.

| Pantalla | Ruta | Estado |
|---|---|---|
| Entrar | `/entrar` | ✅ |
| Crear cuenta (B11) | `/crear-cuenta` | ✅ solo candidatos, como pide el flujo |
| Panel de vacantes (A02) | `/panel` | ✅ una sola llamada |
| Ranking de finalistas (A06) | `/vacantes/:id/ranking` | ✅ alias, CSV, revelar |
| Ver entrega (A07) | `/vacantes/:id/candidatos/:id` | ✅ desglose por criterio |
| Contratar y cerrar (A08) | `/vacantes/:id/cierre` | ✅ con el estado de cada aviso |
| Mis retos | `/mis-retos` | ✅ |
| Reto (B14 + B17) | `/retos/:id` | ✅ enunciado, rúbrica y subida |
| Mi resultado (B22) | `/retos/:id/resultado` | ✅ puntaje, desglose y puesto |

**A01, A03 y A04 no tienen pantalla.** A01 porque el backend no permite
auto-registro de empresas —solo un administrador de plataforma crea una— y A04
porque es la del pago. La empresa y las vacantes se crean hoy con
`sembrar-demo.mjs`.

### Lo que falta aquí

1. **Cuatro commits sin mergear.** A07, A08, el flujo entero del candidato y el
   arreglo del ranking están en `feat/ranking-de-finalistas`. El PR #1 se
   mergeó antes de que se empujaran. **Quien clone `main` hoy ve dos
   pantallas.**
2. **Ninguna prueba.** El andamiaje trae Vitest y no hay una escrita. Es el
   hueco más grande del repositorio: por eso la CI de aquí tiene tres
   verificaciones y la del backend cinco.
3. **`API` está fija en `http://localhost:3000/api/v1`** en
   `nucleo/api/api.ts`. Para desplegar tiene que ser `/api/v1`, relativo al
   mismo origen. **Son dos líneas y es lo que impide desplegar el front.**
4. **Capacitor y la APK.** Paquetes 3.1 y 3.2 de la EDT. No existe.
5. **Sin diseño.** Las diez pantallas son HTML con estilos mínimos: funcionan y
   no se parecen a los mockups de Figma.

---

## 4. Servicio de IA

Repositorio aparte, se despliega aparte, y **solo el módulo de evaluación del
backend lo invoca**. Califica contra la rúbrica y devuelve puntaje por criterio
con evidencia.

Hecho: el contrato, la detección de inyección en la entrega (capas 1 y 2, 4.2),
y las entregas de referencia para calibrar la calificación (4.3).

**La IA nunca recibe el archivo**, solo texto extraído y saneado
([ADR-0008](adr/0008-la-ia-no-recibe-archivos.md)). Un `.ipynb` con una
instrucción escondida es la vía obvia, y por eso la detección vive en los dos
lados.

---

## 5. Despliegue

Lo que más se nota en una sustentación de DevOps, y lo que menos hay.

**Escrito y listo:** `compose.produccion.yaml` sin puertos publicados salvo el
proxy, `Caddyfile` con TLS automático, y `desplegar.yml` que comprueba sus diez
secretos, copia la configuración desde el repositorio, escribe el `.env` **en
el servidor** con `umask 077`, corre las migraciones antes de levantar y
**falla si la aplicación no responde 200**.

**Lo que hace falta y no es trabajo de código:**

| | Quién |
|---|---|
| Un VPS con Ubuntu, 2 vCPU y 4 GB | Daniel |
| Un dominio (DuckDNS sirve, gratis) | Daniel |
| La llave SSH de despliegue | Daniel |
| Los tres Environments de GitHub con sus secretos | Daniel |
| Poner `DESPLIEGUE_HABILITADO=true` | Daniel, **al final** |

El paso a paso está en [`despliegue.md`](despliegue.md).

**El dominio no es una preferencia.** La cookie de sesión es `Secure` en
producción: sobre HTTP plano el navegador la descarta sin avisar, el login
responde 200 y la siguiente petición va sin sesión. Se vería como un bucle de
vuelta a la pantalla de entrar, con los registros limpios y nada que depurar. Y
para TLS hace falta dominio, porque Let's Encrypt no emite certificados para
una IP.

**Lo que este despliegue no tendrá, dicho antes de que se pregunte:** no hay
copias de seguridad, es un solo servidor, no hay vuelta atrás automática, y las
migraciones no se revierten solas.

---

## 6. Lo que no se puede cerrar desde ningún repositorio

- **La Declaración de Alcance sigue en borrador sin ratificar.** Todo lo que
  dice este documento se mide contra un alcance que el equipo no ha firmado.
- **El Project Charter dice Next.js** y se trabaja en Angular, porque es lo
  único que conserva la APK dentro del alcance y el Charter no menciona
  aplicación móvil. **El Charter queda desactualizado y hay que corregirlo
  formalmente.**
- **No hay protección de rama.** La organización está en plan gratuito con
  repositorios privados y GitHub cobra por eso. Las cinco verificaciones de la
  CI son una convención, no una puerta.
- **Dos arreglos de diseño en Figma**, encontrados resolviendo contradicciones
  contra los documentos del propio equipo:
  - El paso 13 del BPM publica el perfil **automáticamente**; B12 lo marca
    opcional y apagado. Manda B12: el Taller 2 ya había diagnosticado ese
    defecto.
  - Al panel de B24 **le sobra «Datos para el Mentor IA»** —nunca se pidió, y
    tratar datos para una finalidad no autorizada es lo que la ley prohíbe— y
    **le falta «Calificación por IA»**, que sí es una de las tres y cuya
    revocación el backend ya hace cumplir.

---

## 7. Si vas a ponerte con algo hoy

Por orden de lo que desbloquea más:

1. **Mergear el PR del front.** Cuatro commits y seis pantallas esperando.
2. **Las dos líneas de `API`** en el front, que es lo único que falta para que
   el front se pueda desplegar.
3. **Las primeras pruebas del front.** Empezar por `nucleo/sesion`: el guardia
   que redirige y recuerda a dónde iba es donde un fallo no se ve a simple
   vista.
4. **Arreglar `npm start`** del backend. Es un `--env-file` en el script.
5. **Levantar el VPS**, que es lo único que no puede hacer nadie más.
