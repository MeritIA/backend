import { Module } from '@nestjs/common';
import { AlertasService } from './alertas.service.js';
import { CorreoService } from './correo.js';

/**
 * Alertas de seguridad por correo (paquete 5.5).
 *
 * No lo importa nadie mas: el servicio se suscribe al bus al arrancar y actua
 * por su cuenta. Quien provoca un evento de seguridad solo lo publica, y no
 * tiene por que saber que esto existe.
 */
@Module({
  providers: [AlertasService, CorreoService],
  exports: [AlertasService],
})
export class AlertasModule {}
