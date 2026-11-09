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
import {
  VerificacionesService,
  type ArchivoDeFoto,
  type EstadoDeVerificacion,
} from './verificaciones.service.js';
import { SesionesService, type EstadoDeSesion } from './sesiones.service.js';
import { SesionDto } from './dto/sesion.dto.js';
import { VerificarEntregaDto } from './dto/verificar-entrega.dto.js';
import { CrearEntregaDto, EntregaRespuesta, FiltroMiasDto, aRespuesta } from './dto/index.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';
import type { Solicitante } from '../vacantes/index.js';
import { LimiteEntrega } from '../../common/rate-limit/index.js';
import { TAMANO_MAXIMO_BYTES } from '../../common/almacenamiento/index.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}
const solicitanteDe = (p: Peticion): Solicitante => ({
  id: p.usuario.id,
  rol: p.usuario.rol,
  idEmpresa: p.usuario.idEmpresa,
});

@ApiTags('entregas')
@ApiBearerAuth('paseto')
@Controller({ path: 'entregas', version: '1' })
export class EntregasController {
  constructor(
    private readonly entregas: EntregasService,
    private readonly verificaciones: VerificacionesService,
    private readonly sesiones: SesionesService,
  ) {}

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

  @Get('sesion')
  @RequierePermiso('entregas:crear')
  @ApiOperation({
    summary: 'Estado de mi sesion cronometrada en un ejercicio',
    description:
      'Devuelve la duracion del ejercicio y, si ya inicio, cuando vence y cuantos segundos le quedan segun el reloj del servidor.',
  })
  estadoDeSesion(@Query() datos: SesionDto, @Req() p: Peticion): Promise<EstadoDeSesion> {
    return this.sesiones.estado(datos.idVacante, datos.idEjercicio, solicitanteDe(p));
  }

  @Post('sesion')
  @RequierePermiso('entregas:crear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inicia la sesion cronometrada de un ejercicio',
    description:
      'Solo para ejercicios con limite de tiempo. Iniciar de nuevo devuelve la misma sesion: no da otra ventana.',
  })
  iniciarSesion(@Body() datos: SesionDto, @Req() p: Peticion): Promise<EstadoDeSesion> {
    return this.sesiones.iniciar(datos.idVacante, datos.idEjercicio, solicitanteDe(p));
  }

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

  @Post(':id/verificacion')
  @RequierePermiso('entregas:crear')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('foto', { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 3 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['modalidad'],
      properties: {
        modalidad: { type: 'string', enum: ['camara', 'alterna'] },
        foto: {
          type: 'string',
          format: 'binary',
          description: 'JPEG o PNG, hasta 2 MiB. Solo con `camara`.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Verifica la entrega propia: foto de camara o modalidad alterna',
    description:
      '`camara` exige el permiso de verificacion biometrica y guarda la foto 90 dias; ' +
      '`alterna` no lleva foto y deja la entrega para verificacion manual de la empresa. Una por entrega.',
  })
  @ApiConflictResponse({ description: 'La entrega ya tiene su verificacion.' })
  verificar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: VerificarEntregaDto,
    @UploadedFile() foto: ArchivoDeFoto | undefined,
    @Req() p: Peticion,
  ): Promise<EstadoDeVerificacion> {
    return this.verificaciones.registrar(id, datos.modalidad, foto, solicitanteDe(p));
  }

  @Get(':id/verificacion')
  @ApiOperation({
    summary: 'Estado de la verificacion de una entrega',
    description:
      'Lo ve el candidato dueño y la empresa de la vacante. `modalidad` es null si aun no se verifico. ' +
      'El enlace a la foto caduca a los cinco minutos.',
  })
  verificacion(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<EstadoDeVerificacion> {
    return this.verificaciones.deEntrega(id, solicitanteDe(p));
  }
}
