import { Module } from '@nestjs/common';
import { AlertasService } from './alertas.service.js';
import { CorreoService } from './correo.js';

/**
 * Alertas de seguridad por correo (paquete 5.5).
 *
 * El servicio de alertas no lo importa nadie: se suscribe al bus al arrancar y
 * actua por su cuenta. Quien provoca un evento de seguridad solo lo publica, y
 * no tiene por que saber que esto existe.
 *
 * CorreoService si se exporta: es el unico sitio del proyecto que habla SMTP, y
 * el modulo de notificaciones lo necesita para escribirle a los candidatos.
 * Exportar la misma instancia y no declararla dos veces importa, porque el
 * transporte mantiene su propia reserva de conexiones.
 */
@Module({
  providers: [AlertasService, CorreoService],
  exports: [AlertasService, CorreoService],
})
export class AlertasModule {}
