# syntax=docker/dockerfile:1

# Imagen Debian slim y no Alpine: los algoritmos de hashing de contrasenas
# (argon2, bcrypt) compilan modulos nativos que dan problemas con musl.
# La version va fijada para que el build sea reproducible.
ARG NODE_VERSION=24.16-slim

# ---------- dependencias ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ---------- build ----------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- desarrollo ----------
# El codigo se monta por volumen desde compose; aqui solo viven las dependencias.
FROM node:${NODE_VERSION} AS dev
ENV NODE_ENV=development
WORKDIR /app
# A diferencia de la etapa de produccion, aqui /app SI pertenece a `node`:
# el modo watch recompila dentro del contenedor y necesita escribir dist/.
RUN chown node:node /app
COPY --chown=node:node package.json package-lock.json .npmrc ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
USER node
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ---------- produccion ----------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Solo dependencias de ejecucion: nada de devDependencies en la imagen final.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

# Los artefactos quedan propiedad de root y el proceso corre como `node`,
# de modo que la aplicacion no puede reescribir su propio codigo.
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000

# Apunta a /api/salud y no a la raiz. La raiz dejo de existir al versionar la
# API bajo /api/v1, y ademas todo endpoint exige token desde que los guardias
# son globales: el healthcheck recibia 404 y habria marcado el contenedor
# enfermo para siempre. /api/salud es publico y sin version a proposito.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
