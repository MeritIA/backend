import { Global, Module } from '@nestjs/common';
import { SaludService } from './salud.service.js';

/**
 * Registro de comprobaciones de salud (paquete 5.5).
 *
 * Global porque lo usan modulos muy distintos —base de datos, almacenamiento,
 * cola, servicio de IA— para registrar su propia comprobacion al arrancar, y
 * obligar a cada uno a importar este modulo solo para eso seria ruido sin
 * ninguna ventaja.
 */
@Global()
@Module({
  providers: [SaludService],
  exports: [SaludService],
})
export class SaludModule {}
