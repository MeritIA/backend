# 0014 · Los consentimientos son un historial, y el backend declara que no los hace cumplir

**Estado:** vigente

## Contexto

La pantalla B12 es el paso 2 de 3 del registro del candidato. Se titula «Antes
de continuar, decide qué autorizas», cita textualmente la **Ley 1581 de 2012** y
promete que «cada permiso es independiente y puedes revocarlo cuando quieras
desde Mi perfil › Privacidad». El panel «Privacidad de tus datos» de B24 repite
la promesa: «puedes revocar cualquiera de estos permisos de forma independiente
y en cualquier momento».

Hasta el 28/10/2026 el backend no tenía dónde guardar nada de eso. Las dos
pantallas prometían al candidato un control sobre sus datos que no existía.

Al transcribir las dos pantallas apareció además que **no piden lo mismo**: B12
pide biometría, calificación por IA y publicación del perfil; B24 ofrece revocar
perfil visible, grabaciones biométricas y **datos para el Mentor IA**, que nadie
pide nunca. Y «calificación por IA», que sí se pide, **no aparece** en el panel
de revocación.

## Decisión

Tres cosas, y la tercera es la que incomoda.

**1. Una tabla que solo crece.** `autenticacion.consentimientos` guarda una fila
por decisión, con el tipo, si se concede o se revoca, la **versión del aviso**
que la persona leyó y desde qué pantalla lo decidió. Revocar inserta una fila
con `concedido = false`. El estado actual es la fila más reciente de cada par
(usuario, tipo). No hay único sobre (usuario, tipo) ni `UPDATE` en ninguna parte.

**2. Nadie ve ni cambia los permisos de otra persona**, ni siquiera un
administrador. El usuario sale del token y no hay identificador en la URL. Las
rutas tampoco llevan permiso de la matriz de roles: ser titular de los propios
datos no es un rol.

**3. El backend registra y NO hace cumplir, y lo dice.** Cada permiso viaja con
`vigilado: false` en la respuesta.

## Alternativas descartadas

- **Un booleano por permiso en `usuarios`.** Es lo más corto y lo que casi todo
  el mundo hace. Dice lo que la persona autoriza hoy y pierde todo lo demás. La
  Ley 1581 no pide el estado: pide poder **demostrar** que el consentimiento se
  obtuvo, para qué finalidad y cuándo. Una reclamación pregunta «¿qué había
  autorizado en marzo?», y un booleano no lo sabe.
- **Guardar la IP y el navegador de cada decisión**, que es lo habitual en los
  registros de consentimiento. Una IP es un dato personal más: recogerla «por si
  acaso» dentro del registro que existe precisamente para no recoger de más es
  contradecirse. Quién, qué, cuándo y desde qué pantalla alcanza para probarlo.
- **Guardar una fila por envío de la pantalla.** El panel manda el estado
  completo cada vez que se toca un interruptor, así que quedarían cien filas
  idénticas y la pregunta que la tabla existe para responder —«desde cuándo
  autoriza esto»— se volvería más difícil, no más fácil. Solo se guarda el
  cambio. (Aceptar explícitamente un permiso que ya venía encendido **sí** se
  guarda: el valor por omisión no demuestra un acto de voluntad.)
- **Clave foránea a `usuarios` con borrado en cascada.** Están en el mismo
  esquema, así que aquí sí era posible. Se deja fuera porque «eliminar cuenta»
  de B24 tiene que poder borrar al usuario y **conservar** la prueba de que un
  día consintió, que es justo lo que la cascada destruiría.
- **Hacer cumplir los permisos ahora.** Es lo que uno querría, y no se puede sin
  inventar producto: las cuatro funciones que gobiernan —proctoring (B15/B16),
  banco de talento (B24), Mentor IA (B22)— no existen en el backend.
- **Callar que no se hacen cumplir.** Sería la opción cómoda. Una pantalla que
  promete control sobre algo que nadie vigila es peor que no prometer nada, y en
  materia de datos personales es una promesa que un día hay que sostener ante
  alguien.
- **Encender «datos para el Mentor IA» porque B24 lo pinta encendido.** Nadie lo
  pide en el registro, así que nadie lo autorizó. Tratar datos para una finalidad
  no autorizada es exactamente lo que la ley prohíbe. Nace apagado.

## Consecuencias

**Lo que cuesta:**

- **Un permiso registrado no es un permiso respetado.** Hoy los cuatro están en
  `vigilado: false`. Cuando se construya proctoring, el banco de talento o el
  Mentor IA, cada uno tiene que llamar a `ConsentimientosService.autoriza()`
  antes de tratar nada, y mover ese campo a `true`. Si alguien construye una de
  esas funciones y no lo hace, el registro se convierte en decoración y nada en
  el código se lo impide.
- **Queda una contradicción abierta y es grande**: si «calificación por IA
  generativa» se puede revocar, quien lo apague no puede ser evaluado, y evaluar
  es el producto entero. Las tres salidas posibles están en el §6.10 de la matriz
  de pantallas. El backend no la decide.
- La tabla crece sin límite y nunca se purga. Es intencional —es un registro
  legal— pero significa que «eliminar cuenta» tendrá que decidir qué hacer con
  ella en vez de borrarla sin pensar.
- Un cambio de texto en cualquier permiso obliga a subir `VERSION_DEL_AVISO` a
  mano. Si se olvida, las decisiones nuevas apuntan a una versión que ya no es la
  que la gente leyó.

**Lo que se gana:** B12 y el panel de B24 se pueden construir hoy, y a la
pregunta «¿desde cuándo autorizaba esta persona esto?» el sistema responde con
una consulta en vez de con una suposición.
