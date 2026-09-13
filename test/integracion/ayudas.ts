import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Client } from 'pg';
import request from 'supertest';
import { BD_DE_PRUEBAS } from './entorno.js';

/**
 * Levanta la aplicacion completa, con la MISMA configuracion que main.ts.
 *
 * Si el montaje de las pruebas se configurara distinto que el arranque real,
 * estas pruebas verificarian una aplicacion que no existe: el caso clasico es
 * olvidar el ValidationPipe y creer que la validacion funciona.
 */
export async function levantarAplicacion(): Promise<INestApplication<Server>> {
  const { AppModule } = await import('../../src/app.module.js');
  const { TodasLasExcepcionesFilter } = await import('../../src/common/errores/index.js');

  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication<INestApplication<Server>>(
    process.env.PRUEBAS_CON_LOG === 'true' ? {} : { logger: false },
  );

  // Sin esto req.cookies no existe y las pruebas del camino web fallarian con
  // 401 aunque el codigo estuviera bien. Tiene que ir aqui porque main.ts lo
  // registra: si los dos montajes divergen, las pruebas verifican una
  // aplicacion que no es la que se despliega.
  app.use(cookieParser());

  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: (process.env.API_VERSION ?? 'v1').replace(/^v/, ''),
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new TodasLasExcepcionesFilter());

  await app.init();
  return app;
}

export const api = (app: INestApplication<Server>) => request(app.getHttpServer());

export interface Sesion {
  readonly id: string;
  readonly token: string;
  readonly correo: string;
}

/**
 * Registra un candidato y devuelve su sesion.
 *
 * Pide `cliente: 'apk'` para recibir el token en el cuerpo. Un cliente web
 * recibiria una cookie HttpOnly y ningun token en el JSON —esa es justamente
 * la proteccion del paquete 3.5— y estas ayudas necesitan el token para
 * ponerlo en la cabecera Authorization de las peticiones siguientes.
 *
 * El camino de cookies tiene sus propias pruebas en tokens-httponly.int-spec.ts.
 */
export async function registrarCandidato(
  app: INestApplication<Server>,
  correo: string,
  nombre = 'Persona De Prueba',
): Promise<Sesion> {
  const { body } = await api(app)
    .post('/api/v1/autenticacion/registro')
    .send({
      correo,
      contrasena: 'una-frase-larga-y-dificil',
      nombreCompleto: nombre,
      cliente: 'apk',
    })
    .expect(201);
  return { id: body.idUsuario as string, token: body.tokenDeAcceso as string, correo };
}

/**
 * Crea un reclutador o administrador.
 *
 * El registro publico solo crea candidatos —esa es justamente una de las
 * defensas que se prueban— asi que el rol se promueve en la base de datos y se
 * vuelve a iniciar sesion para obtener un token que ya lo lleve dentro.
 */
export async function crearConRol(
  app: INestApplication<Server>,
  correo: string,
  rol: 'reclutador' | 'administrador',
): Promise<Sesion> {
  const sesion = await registrarCandidato(app, correo);

  const cliente = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: BD_DE_PRUEBAS,
  });
  await cliente.connect();
  await cliente.query('update autenticacion.usuarios set rol = $1 where id = $2', [rol, sesion.id]);
  await cliente.end();

  const { body } = await api(app)
    .post('/api/v1/autenticacion/login')
    .send({ correo, contrasena: 'una-frase-larga-y-dificil', cliente: 'apk' })
    .expect(200);

  return { id: sesion.id, token: body.tokenDeAcceso as string, correo };
}

/** Consulta directa a la base, para comprobar lo que hay de verdad en la tabla. */
export async function consultar<T = Record<string, unknown>>(
  sql: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  const cliente = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: BD_DE_PRUEBAS,
  });
  await cliente.connect();
  const { rows } = await cliente.query(sql, parametros);
  await cliente.end();
  return rows as T[];
}

export const uuid = (): string => crypto.randomUUID();

/**
 * Crea un ejercicio real en el banco y devuelve su identificador.
 *
 * Desde el paquete 2.3, una vacante no admite identificadores de ejercicio
 * inventados: los valida contra el banco. Las pruebas que asocian ejercicios
 * necesitan uno de verdad.
 */
export async function crearEjercicioEnElBanco(
  app: INestApplication<Server>,
  dueno: Sesion,
  titulo = 'Ejercicio de prueba',
): Promise<string> {
  const { body } = await api(app)
    .post('/api/v1/ejercicios')
    .set({ Authorization: `Bearer ${dueno.token}` })
    .send({
      titulo,
      enunciado: 'Enunciado de prueba suficientemente largo para pasar la validacion del DTO.',
      criterios: [
        {
          nombre: 'Correccion funcional',
          descripcion: 'La solucion resuelve todos los casos del enunciado, incluidos los limite.',
          peso: 100,
          escalaMaxima: 5,
        },
      ],
    })
    .expect(201);
  return body.id as string;
}
