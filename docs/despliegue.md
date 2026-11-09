# Desplegar MeritIA

Un servidor con Docker, el `compose.produccion.yaml` de este repositorio, y la
imagen que la CI publica en GHCR. El despliegue lo hace
[`.github/workflows/desplegar.yml`](../.github/workflows/desplegar.yml) por SSH.

## Antes de nada: hace falta un dominio, y no es una preferencia

La cookie de sesión se emite con `secure: NODE_ENV === 'production'`
(`dominio/tipo-cliente.ts`). Sobre **HTTP plano el navegador la descarta sin
avisar**: el login responde 200, sin error, y la siguiente petición va sin
sesión. Se vería como un bucle de vuelta a la pantalla de entrar, con los
registros limpios y nada que depurar.

Así que hace falta TLS, y para TLS hace falta un dominio: **Let's Encrypt no
emite certificados para una dirección IP.**

- Un dominio propio cuesta unos 12 USD al año.
- Gratis sirve un subdominio de **DuckDNS** (`meritia.duckdns.org`). Para la
  sustentación es suficiente.

## Lo que hay que crear una vez

### 1. El servidor

Cualquier VPS con Ubuntu 24.04 sirve. **2 vCPU y 4 GB de RAM**: en la misma
máquina corren el backend, PostgreSQL, Redis, el almacenamiento y el proxy, y
con 2 GB la evaluación con IA y PostgreSQL se pelean por la memoria.

Hetzner, DigitalOcean o Contabo, entre 5 y 7 USD al mes.

Una vez creado, con una sesión SSH:

```bash
# Docker y el plugin de compose.
curl -fsSL https://get.docker.com | sh

# Un usuario para el despliegue, sin contraseña y sin sudo: solo necesita
# Docker. Si alguien roba la clave, no obtiene una máquina.
sudo adduser --disabled-password --gecos '' despliegue
sudo usermod -aG docker despliegue
sudo mkdir -p /opt/meritia && sudo chown despliegue:despliegue /opt/meritia

# Solo 22, 80 y 443. Las bases de datos NO se publican: el compose de
# producción no les pone `ports`, y el cortafuegos es el segundo cerrojo.
sudo ufw allow 22,80,443/tcp && sudo ufw --force enable
```

### 2. La llave de despliegue

En **tu** máquina, no en el servidor:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/meritia_despliegue -C 'despliegue meritia' -N ''
```

La **pública** (`.pub`) va al servidor:

```bash
ssh-copy-id -i ~/.ssh/meritia_despliegue.pub despliegue@IP_DEL_SERVIDOR
```

La **privada** va al secreto `SSH_KEY` de GitHub. No se guarda en ningún otro
sitio y no se comparte por chat.

### 3. El dominio

Apunta un registro `A` a la IP del servidor. Con DuckDNS es un formulario.
Comprueba que resuelve antes de seguir: `dig +short tu-dominio`.

### 4. Las claves de la aplicación

Las genera el propio repositorio:

```bash
node scripts/generar-claves.mjs
```

Imprime `ENCRYPTION_KEY`, `PASETO_PRIVATE_KEY` y `PASETO_PUBLIC_KEY`. **Cada
ambiente lleva las suyas**: si producción y pruebas comparten clave de cifrado,
un volcado de pruebas descifra datos de producción.

### 5. Los Environments de GitHub

En **Settings › Environments**, crear `desarrollo`, `pruebas` y `produccion`.
En cada uno, estos secretos:

| Secreto | De dónde sale |
|---|---|
| `SSH_HOST` | La IP del servidor |
| `SSH_USER` | `despliegue` |
| `SSH_KEY` | La clave **privada** del paso 2, entera |
| `DOMINIO` | El dominio del paso 3, sin `https://` |
| `DATABASE_PASSWORD` | Una contraseña larga que inventes |
| `ENCRYPTION_KEY` | Del paso 4 |
| `PASETO_PRIVATE_KEY` | Del paso 4 |
| `PASETO_PUBLIC_KEY` | Del paso 4 |
| `S3_ACCESS_KEY` | Un identificador que inventes |
| `S3_SECRET_KEY` | Una cadena larga que inventes |
| `AI_SERVICE_URL` | Opcional. Sin ella entra el evaluador honesto del paquete 4.4 |
| `AI_SERVICE_API_KEY` | Opcional, lo mismo |

**No los crees a nivel de repositorio.** El criterio del paquete 1.2 es que los
secretos no se compartan entre ambientes, y el workflow no usa
`secrets: inherit` justamente para eso.

### 6. Encender el despliegue

Los tres trabajos de despliegue están detrás de la variable de repositorio
**`DESPLIEGUE_HABILITADO`**. Mientras valga otra cosa que `true`, no se ejecutan
y `main` no se pone en rojo. En **Settings › Variables** ponla en `true` cuando
los cinco pasos anteriores estén hechos, y no antes: encenderla sin servidor
deja la rama principal fallando en cada commit.

## Qué pasa en cada despliegue

1. Comprueba que el Environment tiene sus diez secretos. Si falta uno, falla
   diciendo cuál.
2. Copia `compose.produccion.yaml` y el `Caddyfile` **desde el repositorio**, no
   desde lo que hubiera en el servidor. Así lo que corre es lo que está en
   `main` y no lo que alguien editó a mano hace tres semanas.
3. Escribe el `.env` **en el servidor**, por la tubería de SSH y con
   `umask 077`. Nunca toca el disco del runner.
4. Baja la imagen **por digest** y corre las migraciones **antes** de levantar:
   un contenedor nuevo contra un esquema viejo no falla al arrancar, falla en la
   primera consulta de un usuario.
5. `docker compose up -d`.
6. Pide `https://DOMINIO/api/salud` hasta cinco minutos. **Si no responde 200,
   el despliegue falla**: un `up -d` que devuelve cero no significa que la
   aplicación funcione.

## El frontend

Caddy sirve `/srv/web` en `/` y hace de proxy del backend en `/api`. Eso no es
comodidad: la cookie va con `SameSite=strict`, así que un frontend en otro
dominio **no la enviaría nunca**. Mismo origen y el problema no existe.

El repositorio `web` todavía no tiene despliegue. Mientras tanto, a mano:

```bash
cd ../web && npm run build
scp -r dist/web/browser/* despliegue@IP:/opt/meritia/produccion/web/
```

Y en `nucleo/api/api.ts` la constante `API` tiene que pasar de
`http://localhost:3000/api/v1` a `/api/v1`, que es relativo al mismo origen.
**Eso está pendiente y es lo que impide desplegar el front hoy.**

## Lo que este despliegue no tiene

Dicho en voz alta para que nadie lo descubra en la sustentación:

- **No hay copias de seguridad.** Los volúmenes viven en el servidor. Si se
  pierde la máquina, se pierden los datos.
- **Un solo servidor.** No hay alta disponibilidad ni balanceo; si se cae, se
  cayó. Para un MVP es la decisión correcta, pero es una decisión.
- **No hay vuelta atrás automática.** Si el despliegue falla en el paso de
  salud, la versión nueva ya está arriba y rota. Volver es desplegar el
  commit anterior.
- **Las migraciones no se revierten.** Tienen su `down`, pero el despliegue no
  lo ejecuta: deshacer una migración con datos encima es una decisión humana.
