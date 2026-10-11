import { Module } from '@nestjs/common';
import { ReportesService } from './reportes.service.js';
import { ReportesController } from './reportes.controller.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { EntregasModule } from '../entregas/index.js';
import { EvaluacionModule } from '../evaluacion/index.js';
import { VacantesModule } from '../vacantes/index.js';

/**
 * Agrega resultados y genera la informacion consolidada por vacante o candidato
 * (paquete 5.1).
 *
 * Sin TypeOrmModule.forFeature: el modulo no tiene entidades propias porque no
 * es dueno de ningun dato. Compone lo de los otros cuatro por su puerta
 * publica, y el motivo esta explicado en el servicio.
 */
@Module({
  imports: [EvaluacionModule, EntregasModule, VacantesModule, AutenticacionModule],
  controllers: [ReportesController],
  providers: [ReportesService],
  exports: [ReportesService],
})
export class ReportesModule {}
