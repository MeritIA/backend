# 0008 · El servicio de IA es otro proceso y no recibe archivos

**Estado:** vigente · **Decidido por el equipo el 10/10/2026**

## Contexto

Las entregas son archivos que sube gente de fuera: `.zip`, `.pdf`, `.ipynb`,
`.sql`. Alguien tiene que extraer su texto y pedirle al modelo que lo califique
contra la rúbrica.

## Decisión

Dos cosas, y las dos importan:

1. El servicio de IA vive en **otro proceso** (repositorio `ai-service`), y el
   backend le habla por HTTP.
2. Ese servicio **no recibe archivos**: la extracción de texto ocurre en el
   backend, y por la frontera viaja texto ya extraído.

Cuando un formato no se puede extraer hay una respuesta definida para eso: la
entrega queda fallida con su motivo, y **no se consume un intento** del
candidato.

## Alternativas descartadas

**Un solo proceso con el SDK del modelo dentro.** Más simple de desplegar. Se
descarta porque pone la clave del proveedor en el mismo proceso que atiende
peticiones públicas, y porque la cuota de un proveedor pagado quedaría a un
`npm install` de distancia de cualquier parte del código.

**Mandarle el archivo al servicio de IA.** Era la opción natural, y es la que el
equipo rechazó explícitamente: desempaquetar un `.zip` que subió un desconocido
es la operación más peligrosa del sistema —bombas de descompresión, rutas con
`../`— y hacerla en el proceso que tiene la clave del proveedor junta el riesgo
con el premio. Extrayendo en el backend, el servicio de IA solo ve texto.

## Consecuencias

A favor: la clave del proveedor vive en un proceso que no está expuesto. El
código que abre archivos ajenos está donde se le pueden poner límites de tamaño
y de formato. Cambiar de proveedor de IA es cambiar un servicio.

En contra: una llamada de red más, con su `timeout` y su reintento. Y **la
extracción de texto es ahora responsabilidad del backend**, así que el PDF sin
capa de texto y el `.docx` siguen pendientes: hoy esa entrega falla con motivo en
vez de calificarse.
