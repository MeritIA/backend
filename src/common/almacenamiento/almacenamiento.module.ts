import { Global, Module } from '@nestjs/common';
import { AlmacenamientoService } from './almacenamiento.service.js';

/**
 * Global porque es infraestructura compartida: entregas y evaluacion lo usan,
 * y ninguno de los dos deberia tener que importar al otro para conseguirlo.
 */
@Global()
@Module({
  providers: [AlmacenamientoService],
  exports: [AlmacenamientoService],
})
export class AlmacenamientoModule {}
