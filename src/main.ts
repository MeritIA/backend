import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { construirOpcionesCors, origenesPermitidos } from './common/cors/index.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Politica de CORS diferenciada por tipo de cliente (Plan de Seguridad §3).
  app.enableCors(construirOpcionesCors());

  const puerto = process.env.PORT ?? 3000;
  await app.listen(puerto);

  const logger = new Logger('Bootstrap');
  logger.log(`MeritIA escuchando en el puerto ${puerto} (entorno: ${process.env.NODE_ENV})`);
  logger.log(`Origenes permitidos por CORS: ${origenesPermitidos().join(', ') || '(ninguno)'}`);
}

await bootstrap();
