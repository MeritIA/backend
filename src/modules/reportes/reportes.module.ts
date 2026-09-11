import { Module } from '@nestjs/common';
import { ReportesService } from './reportes.service.js';

/** Agrega resultados y genera informacion consolidada por vacante o candidato. */
@Module({
  providers: [ReportesService],
  exports: [ReportesService],
})
export class ReportesModule {}
