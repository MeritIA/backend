import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EntregasService, type ArchivoSubido } from './entregas.service.js';
import { CrearEntregaDto, EntregaRespuesta, FiltroMiasDto, aRespuesta } from './dto/index.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';
import type { Solicitante } from '../vacantes/index.js';
import { LimiteEntrega } from '../../common/rate-limit/index.js';
import { TAMANO_MAXIMO_BYTES } from '../../common/almacenamiento/index.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}
const solicitanteDe = (p: Peticion): Solicitante => ({ id: p.usuario.id, rol: p.usuario.rol });

@ApiTags('entregas')
@ApiBearerAuth('paseto')
@Controller({ path: 'entregas', version: '1' })
export class EntregasController {
  constructor(private readonly entregas: EntregasService) {}

  @Post()
  @RequierePermiso('entregas:crear')
  @LimiteEntrega()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('archivo', {
      // Los limites se aplican MIENTRAS llega el cuerpo, no despues: un archivo
      // de 2 GB se corta al pasar de 25 MiB en vez de cargarse entero en memoria.
      limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1, fields: 5, fieldSize: 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['idVacante', 'idEjercicio', 'archivo'],
      properties: {
        idVacante: { type: 'string', format: 'uuid' },
        idEjercicio: { type: 'string', format: 'uuid' },
        archivo: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Entrega un intento de un ejercicio',
    description:
      'Solo candidatos invitados a una vacante publicada. Extensiones admitidas: zip, tar, gz, tgz, pdf, md, txt, ipynb, sql, json; maximo 25 MiB. Cinco entregas cada cinco minutos.',
  })
  @ApiConflictResponse({ description: 'Se agotaron los intentos permitidos para el ejercicio.' })
  @ApiNotFoundResponse({
    description: 'La vacante no existe o no acepta entregas de este candidato.',
  })
  @ApiPayloadTooLargeResponse({ description: 'El archivo supera 25 MiB.' })
  async entregar(
    @Body() datos: CrearEntregaDto,
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @Req() p: Peticion,
  ): Promise<EntregaRespuesta> {
    return aRespuesta(
      await this.entregas.entregar(datos.idVacante, datos.idEjercicio, archivo, solicitanteDe(p)),
    );
  }

  // Las rutas fijas van antes que `:id`, o `mias` acabaria en el ParseUUIDPipe.

  @Get('mias')
  @RequierePermiso('entregas:leerPropias')
  @ApiOperation({ summary: 'Intentos del candidato autenticado' })
  async mias(@Query() filtro: FiltroMiasDto, @Req() p: Peticion): Promise<EntregaRespuesta[]> {
    return (await this.entregas.mias(solicitanteDe(p), filtro.idVacante)).map(aRespuesta);
  }

  @Get('vacante/:idVacante')
  @RequierePermiso('entregas:leerDeLaVacante')
  @ApiOperation({ summary: 'Entregas de una vacante, para su reclutador o un administrador' })
  async deVacante(
    @Param('idVacante', new ParseUUIDPipe({ version: '4' })) idVacante: string,
    @Req() p: Peticion,
  ): Promise<EntregaRespuesta[]> {
    return (await this.entregas.deVacante(idVacante, solicitanteDe(p))).map(aRespuesta);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulta un intento con su historial de estados',
    description:
      'Para el candidato que lo entrego, el reclutador de la vacante o un administrador. El historial muestra cada cambio de estado con su momento y su motivo.',
  })
  @ApiNotFoundResponse({ description: 'No existe, o quien pregunta no tiene acceso.' })
  async obtener(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<EntregaRespuesta> {
    return aRespuesta(await this.entregas.obtenerPara(id, solicitanteDe(p)));
  }

  @Get(':id/descarga')
  @ApiOperation({
    summary: 'Enlace temporal para descargar el archivo',
    description: 'El enlace esta firmado y caduca a los cinco minutos.',
  })
  enlaceDeDescarga(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<{ url: string; expiraEnSegundos: number }> {
    return this.entregas.enlaceDeDescarga(id, solicitanteDe(p));
  }
}
