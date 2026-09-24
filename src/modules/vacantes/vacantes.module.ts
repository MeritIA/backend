import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vacante } from './entities/vacante.entity.js';
import { VacanteEjercicio } from './entities/vacante-ejercicio.entity.js';
import { VacanteCandidato } from './entities/vacante-candidato.entity.js';
import { VacantesService } from './vacantes.service.js';
import { VacantesController } from './vacantes.controller.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { EjerciciosModule } from '../ejercicios/index.js';

/** Ofertas de trabajo, sus ejercicios y los candidatos invitados a cada una. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Vacante, VacanteEjercicio, VacanteCandidato]),
    AutenticacionModule,
    // Para validar que los ejercicios asociados existan en el banco.
    EjerciciosModule,
  ],
  controllers: [VacantesController],
  providers: [VacantesService],
  exports: [VacantesService],
})
export class VacantesModule {}
