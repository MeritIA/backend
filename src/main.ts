import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { construirOpcionesCors, origenesPermitidos } from './common/cors/index.js';
import {
  construirDocumentoOpenApi,
  debePublicarseLaInterfaz,
  publicarOpenApi,
} from './docs/index.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Politica de CORS diferenciada por tipo de cliente (Plan de Seguridad §3).
  app.enableCors(construirOpcionesCors());

  // OpenAPI generada desde el codigo (paquete 5.2). Se construye siempre, para
  // que el script de exportacion la obtenga sin levantar el servidor, y solo se
  // publica la interfaz navegable donde corresponda.
  const documento = construirDocumentoOpenApi(app);
  if (debePublicarseLaInterfaz()) {
    publicarOpenApi(app, documento);
  }

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
