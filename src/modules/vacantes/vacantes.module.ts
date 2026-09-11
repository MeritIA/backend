import { Module } from '@nestjs/common';
import { VacantesService } from './vacantes.service.js';

/** Creacion y gestion de ofertas, y su asociacion con ejercicios. */
@Module({
  providers: [VacantesService],
  exports: [VacantesService],
})
export class VacantesModule {}
