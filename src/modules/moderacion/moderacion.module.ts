import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Caso } from './entities/caso.entity.js';
import { ModeracionService } from './moderacion.service.js';
import { ModeracionController } from './moderacion.controller.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { EvaluacionModule } from '../evaluacion/index.js';
import { ReportesModule } from '../reportes/index.js';

/** Revision humana de evaluaciones marcadas o muestreadas. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Caso]),
    AutenticacionModule,
    EvaluacionModule,
    ReportesModule,
  ],
  controllers: [ModeracionController],
  providers: [ModeracionService],
  exports: [ModeracionService],
})
export class ModeracionModule {}
