import { ApiProperty } from '@nestjs/swagger';
import { EstadoDeAviso, TipoDeAviso } from '../dominio/estado-aviso.js';

/**
 * Una fila del registro de avisos.
 *
 * NO LLEVA LA DIRECCION DE CORREO, a proposito. El reclutador ve el ranking por
 * alias hasta que revela una identidad, y eso queda auditado (paquete 5.1).
 * Devolver aqui los correos seria la puerta de atras de ese control: se
 * consultarian los avisos y se tendrian las direcciones de todos los
 * participantes sin que nadie registrara nada. El identificador ya aparece en
 * el ranking, asi que esto no anade nada nuevo.
 */
export class AvisoRespuesta {
  @ApiProperty({ format: 'uuid' }) idCandidato!: string;

  @ApiProperty({ enum: TipoDeAviso }) tipo!: TipoDeAviso;

  @ApiProperty({
    enum: EstadoDeAviso,
    description:
      'pendiente: registrado y sin enviar. enviando: reservado por una ronda en curso. ' +
      'enviada: entregado al servidor de correo. sin_canal: no hay SMTP configurado. ' +
      'fallida: el servidor rechazo el envio.',
  })
  estado!: EstadoDeAviso;

  @ApiProperty({ minimum: 0 }) intentos!: number;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  enviadoEn!: Date | null;

  @ApiProperty({ nullable: true, type: String })
  ultimoError!: string | null;
}

/** Lo que dejo una ronda de avisos. Cifras, para que el reclutador sepa si salio. */
export class ResumenDeAvisosRespuesta {
  @ApiProperty({ format: 'uuid' }) idVacante!: string;

  @ApiProperty({
    minimum: 0,
    description: 'Candidatos con al menos una entrega evaluada: los que pueden recibir aviso.',
  })
  considerados!: number;

  @ApiProperty({ minimum: 0, description: 'Avisos creados en esta ronda.' })
  nuevos!: number;

  @ApiProperty({ minimum: 0 }) enviados!: number;

  @ApiProperty({ minimum: 0, description: 'Sin enviar porque no hay SMTP configurado.' })
  sinCanal!: number;

  @ApiProperty({ minimum: 0 }) fallidos!: number;

  @ApiProperty({ minimum: 0, description: 'Ya los tenian enviados y no se volvieron a tocar.' })
  yaAvisados!: number;

  @ApiProperty({
    required: false,
    enum: ['vacante_inexistente', 'vacante_no_cerrada', 'canal_apagado'],
    description:
      'Por que no se envio nada. canal_apagado significa que NOTIFICACIONES_A_CANDIDATOS esta en false: ' +
      'los avisos quedaron registrados como pendientes y un reenvio los recoge cuando se encienda.',
  })
  omitido?: string;
}
