import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { construirOpcionesCors, origenesPermitidos } from './common/cors/index.js';
import { TodasLasExcepcionesFilter } from './common/errores/index.js';
import {
  construirDocumentoOpenApi,
  debePublicarseLaInterfaz,
  publicarOpenApi,
} from './docs/index.js';

interface ResponseMinima {
  status: (codigo: number) => { json: (cuerpo: unknown) => void };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Sin esto, req.cookies no existe y el token de la web nunca se leeria.
  app.use(cookieParser());

  // Politica de CORS diferenciada por tipo de cliente (Plan de Seguridad §3).
  app.enableCors(construirOpcionesCors());

  // --- Paquete 2.4: API versionada, validacion por DTO y errores sin fugas ---

  // Convencion de versionado: /api/v1/<modulo>/<recurso>. Va en la ruta y no en
  // una cabecera porque se ve en los logs, en el navegador y en un curl, y
  // porque el planteamiento de arquitectura pide la API "versionada" desde su
  // primera version.
  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: (process.env.API_VERSION ?? 'v1').replace(/^v/, ''),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Descarta cualquier propiedad que el DTO no declare, en vez de dejarla
      // llegar al servicio: es lo que impide que alguien cuele `rol:
      // "administrador"` en el cuerpo de un registro.
      whitelist: true,
      // Y ademas lo rechaza en lugar de ignorarlo en silencio, para que un
      // cliente mal escrito se entere en vez de creer que su campo se guardo.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Los mensajes de validacion SI se muestran, tambien en produccion: el
      // criterio del paquete 2.4 pide "un mensaje de validacion entendible", y
      // hablan del cuerpo que envio el propio cliente, no del interior del
      // sistema. Silenciarlos dejaria un 400 sin explicacion.
    }),
  );

  // Ultimo recurso: ninguna excepcion llega al cliente con su traza.
  app.useGlobalFilters(new TodasLasExcepcionesFilter());

  // OpenAPI generada desde el codigo (paquete 5.2). Se construye siempre, para
  // que el script de exportacion la obtenga sin levantar el servidor, y solo se
  // publica la interfaz navegable donde corresponda.
  const documento = construirDocumentoOpenApi(app);
  if (debePublicarseLaInterfaz()) {
    publicarOpenApi(app, documento);
  }

  // Manejador final para toda ruta que ningun controlador atienda. Va a nivel
  // de Express y despues de que Nest monte las suyas, que es lo unico que
  // garantiza que corra el ultimo.
  //
  // Antes esto era un controlador comodin de Nest, y estaba MAL: se registraba
  // junto a los controladores del modulo raiz, es decir ANTES que los de los
  // modulos importados, asi que capturaba todas sus rutas y devolvia 401 o 404
  // en endpoints que si existian. El sintoma no apuntaba a la causa.
  await app.init();
  const servidor = app.getHttpAdapter().getInstance() as {
    use: (fn: (req: { url?: string }, res: ResponseMinima) => void) => void;
  };
  servidor.use((req, res) => {
    res.status(404).json({
      estado: 404,
      codigo: 'NO_ENCONTRADO',
      mensaje: 'La ruta solicitada no existe en esta API.',
      momento: new Date().toISOString(),
      ruta: req.url ?? '',
      referencia: randomUUID(),
    });
  });

  const puerto = process.env.PORT ?? 3000;
  await app.listen(puerto);

  const logger = new Logger('Bootstrap');
  logger.log(`MeritIA escuchando en el puerto ${puerto} (entorno: ${process.env.NODE_ENV})`);
  logger.log(`Origenes permitidos por CORS: ${origenesPermitidos().join(', ') || '(ninguno)'}`);
  if (debePublicarseLaInterfaz()) {
    logger.log(`Documentacion de la API en http://localhost:${puerto}/api/docs`);
  }
}

await bootstrap();
