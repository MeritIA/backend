import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  NotificacionesService,
  type EstadoDeUnAviso,
  type ResumenDeAvisos,
} from './notificaciones.service.js';
import { AvisoRespuesta, ResumenDeAvisosRespuesta } from './dto/aviso.dto.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';
import type { Solicitante } from '../vacantes/index.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}

const solicitanteDe = (p: Peticion): Solicitante => ({
  id: p.usuario.id,
  rol: p.usuario.rol,
  idEmpresa: p.usuario.idEmpresa,
});

/**
 * Avisos por correo de una vacante.
 *
 * NO HAY RUTA PARA ENVIAR UN AVISO SUELTO, y es deliberado: el aviso lo
 * dispara el cierre de la vacante, no una persona apretando un boton. Lo que se
 * expone es mirar que paso y reintentar lo que no salio. Un endpoint de "enviar
 * correo a este candidato" seria una herramienta de envio masivo dentro de un
 * producto que no es eso.
 *
 * Las dos rutas cuelgan de una vacante y el servicio comprueba que sea de la
 * empresa de quien pregunta: cambiar el identificador en la URL devuelve 404,
 * nunca datos de otra empresa.
 */
@ApiTags('notificaciones')
@ApiBearerAuth('paseto')
@Controller({ path: 'notificaciones', version: '1' })
export class NotificacionesController {
  constructor(private readonly notificaciones: NotificacionesService) {}

  @Get('vacantes/:idVacante')
  @RequierePermiso('notificaciones:verDeLaVacante')
  @ApiOperation({
    summary: 'Que avisos se enviaron de una vacante, y en que quedo cada uno',
    description:
      'No devuelve direcciones de correo: el ranking se ve por alias hasta que se revela una identidad, ' +
      'y eso queda auditado. Devolver los correos aqui seria la puerta de atras de ese control.',
  })
  @ApiOkResponse({ type: AvisoRespuesta, isArray: true })
  @ApiNotFoundResponse({ description: 'La vacante no existe o no es de tu empresa.' })
  estado(
    @Param('idVacante', ParseUUIDPipe) idVacante: string,
    @Req() p: Peticion,
  ): Promise<EstadoDeUnAviso[]> {
    return this.notificaciones.estadoDeLaVacante(idVacante, solicitanteDe(p));
  }

  @Post('vacantes/:idVacante/reenviar')
  @HttpCode(HttpStatus.OK)
  @RequierePermiso('notificaciones:reenviar')
  @ApiOperation({
    summary: 'Reintenta los avisos que no salieron de una vacante cerrada',
    description:
      'Se puede apretar dos veces sin consecuencias: nunca toca un aviso ya enviado, asi que no existe ' +
      'el correo repetido. Tambien crea el aviso de quien se evaluo despues del cierre. ' +
      'Si la vacante no esta cerrada no envia nada y lo dice en "omitido".',
  })
  @ApiOkResponse({ type: ResumenDeAvisosRespuesta })
  @ApiNotFoundResponse({ description: 'La vacante no existe o no es de tu empresa.' })
  reenviar(
    @Param('idVacante', ParseUUIDPipe) idVacante: string,
    @Req() p: Peticion,
  ): Promise<ResumenDeAvisos> {
    return this.notificaciones.reenviar(idVacante, solicitanteDe(p));
  }
}
