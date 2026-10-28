import { BadRequestException, Body, Controller, Get, Put, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConsentimientosService } from './consentimientos.service.js';
import { ConsentimientosRespuesta, RegistrarConsentimientosDto } from './dto/index.js';
import { TipoDeConsentimiento, VERSION_DEL_AVISO } from './dominio/consentimiento.js';
import type { UsuarioAutenticado } from './guardias/autenticacion.guard.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}

/**
 * Los permisos del titular de los datos: pantalla B12 y el panel "Privacidad
 * de tus datos" de B24.
 *
 * NO LLEVA @RequierePermiso, Y NO ES UN OLVIDO
 *
 * La matriz de permisos resuelve quien puede actuar sobre recursos de la
 * plataforma. Esto no es un recurso de la plataforma: son los datos de quien
 * pregunta. Cualquier persona autenticada —candidato, reclutador o
 * administrador— es titular de los suyos, y la Ley 1581 no reparte ese derecho
 * por rol. Exigir un permiso aqui dejaria a un reclutador sin poder revocar
 * nada sobre si mismo.
 *
 * NO HAY RUTA PARA VER NI CAMBIAR LOS DE OTRA PERSONA, ni siquiera para un
 * administrador. El usuario sale del token y nunca de la URL: no hay
 * identificador que cambiar.
 */
@ApiTags('autenticacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Sin sesion.' })
@Controller({ path: 'autenticacion/consentimientos', version: '1' })
export class ConsentimientosController {
  constructor(private readonly consentimientos: ConsentimientosService) {}

  @Get()
  @ApiOperation({
    summary: 'Mis permisos sobre el tratamiento de mis datos',
    description:
      'Devuelve SIEMPRE los cuatro permisos del catalogo, decididos o no, con el texto que ' +
      'la pantalla debe mostrar. `porOmision: true` significa que el titular nunca lo decidio ' +
      'y vale el valor inicial. `vigilado` dice si el backend lo hace cumplir hoy.',
  })
  @ApiOkResponse({ type: ConsentimientosRespuesta })
  async mios(@Req() p: Peticion): Promise<ConsentimientosRespuesta> {
    return {
      permisos: await this.consentimientos.mios(p.usuario.id),
      versionDelAviso: VERSION_DEL_AVISO,
    };
  }

  /**
   * PUT y no PATCH porque la pantalla manda el estado que quiere dejar, no un
   * cambio relativo. Es idempotente: repetir la misma llamada no guarda nada,
   * y la respuesta lo dice en `registradas`.
   */
  @Put()
  @ApiOperation({
    summary: 'Concede o revoca mis permisos',
    description:
      'Cada decision queda registrada con la version del aviso y desde donde se tomo. ' +
      'Las decisiones que no cambian nada no se guardan, para que el historial siga ' +
      'respondiendo desde cuando el titular autoriza cada cosa.',
  })
  @ApiOkResponse({ type: ConsentimientosRespuesta })
  @ApiBadRequestResponse({ description: 'Un tipo repetido o una decision mal formada.' })
  async registrar(
    @Body() datos: RegistrarConsentimientosDto,
    @Req() p: Peticion,
  ): Promise<ConsentimientosRespuesta> {
    const decisiones = new Map<TipoDeConsentimiento, boolean>();
    for (const d of datos.decisiones) {
      // Dos decisiones contrarias sobre el mismo permiso en una sola llamada no
      // tienen una lectura correcta: quedarse con la ultima seria adivinar cual
      // queria la persona. Es un error de quien llama, y se dice.
      if (decisiones.has(d.tipo)) {
        throw new BadRequestException(
          `El permiso "${d.tipo}" viene dos veces en la misma llamada.`,
        );
      }
      decisiones.set(d.tipo, d.concedido);
    }

    const resultado = await this.consentimientos.registrar(p.usuario.id, decisiones, datos.origen);

    return {
      permisos: resultado.permisos,
      versionDelAviso: VERSION_DEL_AVISO,
      registradas: resultado.registradas,
    };
  }
}
