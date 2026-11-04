import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ejercicio } from './entities/ejercicio.entity.js';
import { EjercicioVersion } from './entities/ejercicio-version.entity.js';
import { CriterioRubrica } from './entities/criterio-rubrica.entity.js';
import { Adjunto } from './entities/adjunto.entity.js';
import { EjerciciosService } from './ejercicios.service.js';
import { EjerciciosController } from './ejercicios.controller.js';
import { AutenticacionModule } from '../autenticacion/index.js';

/** Banco de pruebas tecnicas con sus rubricas y su versionado. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Ejercicio, EjercicioVersion, CriterioRubrica, Adjunto]),
    AutenticacionModule,
  ],
  controllers: [EjerciciosController],
  providers: [EjerciciosService],
  exports: [EjerciciosService],
})
export class EjerciciosModule {}
