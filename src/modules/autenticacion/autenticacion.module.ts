import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { Usuario } from './entities/usuario.entity.js';
import { AutenticacionService } from './autenticacion.service.js';
import { AutenticacionController } from './autenticacion.controller.js';
import { PasetoService } from './servicios/paseto.service.js';
import { ContrasenasService } from './servicios/contrasenas.service.js';
import { AutenticacionGuard } from './guardias/autenticacion.guard.js';
import { RolesGuard } from './guardias/roles.guard.js';

/**
 * Registro, inicio de sesion, renovacion y roles.
 *
 * Los dos guardias se registran como globales y en este orden: primero se
 * resuelve QUIEN eres, despues SI puedes. Al ser globales, todo endpoint queda
 * protegido salvo que se marque con @Publico(), que es lo contrario de proteger
 * solo lo decorado: un olvido deja el endpoint cerrado, no abierto.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Usuario])],
  controllers: [AutenticacionController],
  providers: [
    AutenticacionService,
    PasetoService,
    ContrasenasService,
    { provide: APP_GUARD, useClass: AutenticacionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AutenticacionService],
})
export class AutenticacionModule {}
