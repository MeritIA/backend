import { Module } from '@nestjs/common';
import { EvaluacionService } from './evaluacion.service.js';

/** Orquesta la calificacion: arma el envio al servicio de IA y guarda resultados. */
@Module({
  providers: [EvaluacionService],
  exports: [EvaluacionService],
})
export class EvaluacionModule {}
