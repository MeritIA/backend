import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Aviso } from './entities/aviso.entity.js';
import { NotificacionesService } from './notificaciones.service.js';
import { NotificacionesController } from './notificaciones.controller.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { VacantesModule } from '../vacantes/index.js';
import { EvaluacionModule } from '../evaluacion/index.js';
import { AlertasModule } from '../../common/alertas/index.js';

/**
 * Avisos por correo a los candidatos.
 *
 * Es un consumidor final del grafo de modulos: importa a tres y ninguno lo
 * importa a el. Por eso anadirlo no cambia las dependencias que ya habia, y por
 * eso el cierre de una vacante no sabe que esto existe —se enteran por el bus—.
 *
 * De AlertasModule solo usa CorreoService, que es el que sabe hablar SMTP.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Aviso]),
    // Para la direccion y el nombre del candidato, por la puerta del modulo.
    AutenticacionModule,
    // Para el titulo de la vacante y para comprobar de quien es.
    VacantesModule,
    // Para saber quien participo de verdad.
    EvaluacionModule,
    AlertasModule,
  ],
  controllers: [NotificacionesController],
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
