import { Module } from '@nestjs/common';
import { EjerciciosService } from './ejercicios.service.js';

/** Banco de pruebas tecnicas con sus rubricas y versiones. */
@Module({
  providers: [EjerciciosService],
  exports: [EjerciciosService],
})
export class EjerciciosModule {}
