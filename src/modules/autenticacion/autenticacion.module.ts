import { Module } from '@nestjs/common';
import { AutenticacionService } from './autenticacion.service.js';

/** Registro, inicio de sesion y roles: candidato, reclutador y administrador. */
@Module({
  providers: [AutenticacionService],
  exports: [AutenticacionService],
})
export class AutenticacionModule {}
