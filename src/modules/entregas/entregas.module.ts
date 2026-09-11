import { Module } from '@nestjs/common';
import { EntregasService } from './entregas.service.js';

/** Recepcion y control del estado de los intentos de cada candidato. */
@Module({
  providers: [EntregasService],
  exports: [EntregasService],
})
export class EntregasModule {}
