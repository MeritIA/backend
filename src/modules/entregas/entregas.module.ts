import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Entrega } from './entities/entrega.entity.js';
import { HistorialEstadoEntrega } from './entities/historial-estado-entrega.entity.js';
import { EntregasService } from './entregas.service.js';
import { EntregasController } from './entregas.controller.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { VacantesModule } from '../vacantes/index.js';

/** Intentos de los candidatos, su estado y su historial. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Entrega, HistorialEstadoEntrega]),
    AutenticacionModule,
    VacantesModule,
  ],
  controllers: [EntregasController],
  providers: [EntregasService],
  exports: [EntregasService],
})
export class EntregasModule {}
