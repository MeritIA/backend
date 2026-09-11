import { ApiProperty } from '@nestjs/swagger';
import { Rol } from '../dominio/rol.js';

/** Lo que devuelven registro, login y renovacion. */
export class SesionRespuesta {
  @ApiProperty({ description: 'Token PASETO v4 para consumir la API.' })
  tokenDeAcceso!: string;

  @ApiProperty({
    description: 'Token para obtener uno de acceso nuevo sin volver a iniciar sesion.',
  })
  tokenDeRenovacion!: string;

  @ApiProperty({ description: 'Expiracion del token de acceso, en ISO8601.' })
  expiraEn!: string;

  @ApiProperty({ enum: Rol })
  rol!: Rol;

  @ApiProperty({ format: 'uuid' })
  idUsuario!: string;
}
