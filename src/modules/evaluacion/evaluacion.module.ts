import { Module } from '@nestjs/common';
import { EvaluacionService } from './evaluacion.service.js';
import { EvaluacionesController } from './evaluaciones.controller.js';
import { ColaDeEvaluacionService } from './cola/cola-de-evaluacion.service.js';
import { EVALUADOR, EvaluadorSinServicioDeIa } from './cola/evaluador.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { EntregasModule } from '../entregas/index.js';

/** Orquesta la calificacion: arma el envio al servicio de IA y guarda resultados. */
@Module({
  imports: [AutenticacionModule, EntregasModule],
  controllers: [EvaluacionesController],
  providers: [
    EvaluacionService,
    ColaDeEvaluacionService,
    // El paquete 4.4 sustituye este proveedor por el adaptador del servicio de IA.
    { provide: EVALUADOR, useClass: EvaluadorSinServicioDeIa },
  ],
  exports: [EvaluacionService, ColaDeEvaluacionService],
})
export class EvaluacionModule {}
