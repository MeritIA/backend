import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { LONGITUD_MINIMA_DEL_MOTIVO } from '../dominio/estado-postulacion.js';

/**
 * El motivo es obligatorio, y no es tramite.
 *
 * Es lo unico que el candidato recibe cuando no avanza. El diagrama del equipo
 * pide "feedback de por que un candidato no avanzo"; sin un texto escrito por
 * quien decidio no hay nada que mostrarle. El minimo existe para que "no" no
 * cuente como respuesta.
 */
export class RechazarPostulacionDto {
  @ApiProperty({
    minLength: LONGITUD_MINIMA_DEL_MOTIVO,
    maxLength: 500,
    description:
      'Por que no avanza. Se le muestra al candidato tal cual, asi que se escribe para que lo lea el.',
    example: 'Buscamos experiencia especifica en conciliacion de pagos y tu perfil apunta a datos.',
  })
  @IsString({ message: 'motivo debe ser texto' })
  @Length(LONGITUD_MINIMA_DEL_MOTIVO, 500, {
    message: `motivo debe tener entre ${LONGITUD_MINIMA_DEL_MOTIVO} y 500 caracteres: es lo unico que el candidato recibe`,
  })
  motivo!: string;
}
