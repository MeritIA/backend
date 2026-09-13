import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Rol } from '../dominio/rol.js';

/**
 * Lo que devuelven registro, login y renovacion.
 *
 * OJO A LOS DOS CAMPOS OPCIONALES: los tokens **solo aparecen para la APK**.
 *
 * Para un cliente web viajan en cookies HttpOnly y estos campos llegan vacios,
 * porque incluirlos anularia la proteccion: la cookie impide que JavaScript lea
 * el token en las peticiones siguientes, pero si el token viniera tambien en
 * este JSON, un XSS podria leerlo directamente de la respuesta del login.
 *
 * Plan de Seguridad §7.2, y primer criterio de aceptacion del paquete 3.5.
 */
export class SesionRespuesta {
  @ApiPropertyOptional({
    description:
      'Token PASETO de acceso. SOLO se devuelve cuando el cliente es "apk". En web viaja en la cookie HttpOnly meritia_acceso.',
  })
  tokenDeAcceso?: string;

  @ApiPropertyOptional({
    description:
      'Token de renovacion. SOLO se devuelve cuando el cliente es "apk". En web viaja en la cookie HttpOnly meritia_renovacion.',
  })
  tokenDeRenovacion?: string;

  @ApiProperty({ description: 'Expiracion del token de acceso, en ISO8601.' })
  expiraEn!: string;

  @ApiProperty({ enum: Rol })
  rol!: Rol;

  @ApiProperty({ format: 'uuid' })
  idUsuario!: string;
}
