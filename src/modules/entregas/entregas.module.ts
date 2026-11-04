import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Entrega } from './entities/entrega.entity.js';
import { HistorialEstadoEntrega } from './entities/historial-estado-entrega.entity.js';
import { Sesion } from './entities/sesion.entity.js';
import { SesionesService } from './sesiones.service.js';
import { Verificacion } from './entities/verificacion.entity.js';
import { EntregasService } from './entregas.service.js';
import { VerificacionesService } from './verificaciones.service.js';
import { EntregasController } from './entregas.controller.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { VacantesModule } from '../vacantes/index.js';
import { EjerciciosModule } from '../ejercicios/index.js';

/** Intentos de los candidatos, su estado y su historial. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Entrega, HistorialEstadoEntrega, Verificacion, Sesion]),
    AutenticacionModule,
    VacantesModule,
    EjerciciosModule,
  ],
  controllers: [EntregasController],
  providers: [EntregasService, VerificacionesService, SesionesService],
  exports: [EntregasService],
})
export class EntregasModule {}
