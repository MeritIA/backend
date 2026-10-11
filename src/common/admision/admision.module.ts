import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AdmisionService } from './admision.service.js';
import { AdmisionMiddleware } from './admision.middleware.js';

/**
 * Control de admision (P1 de docs/rendimiento.md).
 *
 * Global porque el contador es uno por proceso: dos instancias del servicio
 * contarian la mitad cada una y el tope real seria el doble del configurado.
 *
 * El middleware se aplica a todas las rutas desde aqui, y no con `app.use` en
 * main.ts, para que entre igual en el arnes de las pruebas de integracion. Las
 * rutas de salud se excluyen dentro del propio middleware y no con un patron:
 * un patron de exclusion hay que mantenerlo sincronizado con el prefijo de la
 * API, y el middleware ya lo lee de la configuracion.
 */
@Global()
@Module({
  providers: [AdmisionService, AdmisionMiddleware],
  exports: [AdmisionService],
})
export class AdmisionModule implements NestModule {
  configure(consumidor: MiddlewareConsumer): void {
    consumidor.apply(AdmisionMiddleware).forRoutes('*');
  }
}
