import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportesService } from './reportes.service.js';
import { RevelacionDeIdentidad } from './entities/revelacion-de-identidad.entity.js';
import { ReportesController } from './reportes.controller.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { EntregasModule } from '../entregas/index.js';
import { EvaluacionModule } from '../evaluacion/index.js';
import { VacantesModule } from '../vacantes/index.js';

/**
 * Agrega resultados y genera la informacion consolidada por vacante o candidato
 * (paquete 5.1).
 *
 * Tiene UNA entidad: el registro de quien revelo la identidad de un candidato.
 * No contradice la decision de no copiar datos ajenos —ese sigue siendo el
 * motivo de que no haya tabla de notas—: es un dato nuevo que solo produce
 * reportes, asi que no puede desincronizarse de nada.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RevelacionDeIdentidad]),
    EvaluacionModule,
    EntregasModule,
    VacantesModule,
    AutenticacionModule,
  ],
  controllers: [ReportesController],
  providers: [ReportesService],
  exports: [ReportesService],
})
export class ReportesModule {}
