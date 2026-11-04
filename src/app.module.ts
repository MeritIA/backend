import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarEntorno } from './config/index.js';
import { DatabaseModule } from './database/index.js';
import { RateLimitModule } from './common/rate-limit/index.js';
import { AlmacenamientoModule } from './common/almacenamiento/index.js';
import { EventosModule } from './common/events/index.js';
import { SaludController, SaludModule } from './common/salud/index.js';
import { AlertasModule } from './common/alertas/index.js';
import { AdmisionModule } from './common/admision/index.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AutenticacionModule } from './modules/autenticacion/index.js';
import { VacantesModule } from './modules/vacantes/index.js';
import { EjerciciosModule } from './modules/ejercicios/index.js';
import { EntregasModule } from './modules/entregas/index.js';
import { EvaluacionModule } from './modules/evaluacion/index.js';
import { ReportesModule } from './modules/reportes/index.js';
import { NotificacionesModule } from './modules/notificaciones/index.js';
import { ModeracionModule } from './modules/moderacion/index.js';

/**
 * Raiz del monolito modular.
 *
 * Los modulos de negocio se registran aqui, cada uno con su frontera
 * explicita. La regla que sostiene el orden es que ningun modulo importa una
 * entidad o un repositorio de otro: toda interaccion pasa por el servicio de
 * aplicacion que el modulo reexporta en su index, o por eventos internos.
 * `npm run lint` falla si se incumple.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Si el entorno viene incompleto, el proceso no arranca.
      validate: validarEntorno,
    }),
    // Va primero: cada parte registra en el su propia comprobacion al arrancar.
    SaludModule,
    AlertasModule,
    // Antes que los modulos de negocio: su middleware tiene que poder rechazar
    // una peticion antes de que nadie haga trabajo con ella.
    AdmisionModule,
    DatabaseModule,
    RateLimitModule,
    AlmacenamientoModule,
    EventosModule,
    AutenticacionModule,
    VacantesModule,
    EjerciciosModule,
    EntregasModule,
    EvaluacionModule,
    ReportesModule,
    // Ultimo a proposito: solo escucha y no lo importa nadie.
    NotificacionesModule,
    ModeracionModule,
  ],
  controllers: [AppController, SaludController],
  providers: [AppService],
})
export class AppModule {}
