import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EjerciciosService, type ResumenVersion, type Solicitante } from './ejercicios.service.js';
import { CrearEjercicioDto, NuevaVersionDto } from './dto/index.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';
import type { Ejercicio } from './entities/ejercicio.entity.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}
const solicitanteDe = (p: Peticion): Solicitante => ({
  id: p.usuario.id,
  rol: p.usuario.rol,
  idEmpresa: p.usuario.idEmpresa,
});

@ApiTags('ejercicios')
@ApiBearerAuth('paseto')
@Controller({ path: 'ejercicios', version: '1' })
export class EjerciciosController {
  constructor(private readonly ejercicios: EjerciciosService) {}

  @Post()
  @RequierePermiso('ejercicios:crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea un ejercicio con su rubrica',
    description:
      'Crea el ejercicio y su version 1 en una sola operacion. Los pesos de los criterios deben sumar 100: con otra suma la nota final no seria comparable entre ejercicios, y se devuelve 400.',
  })
  crear(@Body() datos: CrearEjercicioDto, @Req() p: Peticion): Promise<Ejercicio> {
    return this.ejercicios.crear(datos, solicitanteDe(p));
  }

  @Get()
  @RequierePermiso('ejercicios:leer')
  @ApiOperation({
    summary: 'Lista el banco de ejercicios',
    description: 'Un reclutador ve los suyos; un administrador, todos.',
  })
  listar(@Req() p: Peticion): Promise<Ejercicio[]> {
    return this.ejercicios.listar(solicitanteDe(p));
  }

  @Get(':id')
  @RequierePermiso('ejercicios:leer')
  @ApiOperation({
    summary: 'Consulta un ejercicio con todas sus versiones',
    description: 'Las versiones llegan de la mas reciente a la mas antigua, con su rubrica.',
  })
  @ApiNotFoundResponse({
    description:
      'El ejercicio no existe, o no es de quien pregunta. Se responde lo mismo en ambos casos.',
  })
  obtener(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<Ejercicio> {
    return this.ejercicios.obtenerPara(id, solicitanteDe(p));
  }

  @Post(':id/versiones')
  @RequierePermiso('ejercicios:editar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea la version siguiente',
    description:
      'Las versiones anteriores NO se modifican: es la unica forma de que una calificacion emitida hace un mes siga mostrando el enunciado y los pesos con los que se calculo. Corregir un enunciado significa versionar, nunca editar.',
  })
  nuevaVersion(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: NuevaVersionDto,
    @Req() p: Peticion,
  ): Promise<Ejercicio> {
    return this.ejercicios.nuevaVersion(id, datos, solicitanteDe(p));
  }

  @Post(':id/adjuntos')
  @RequierePermiso('ejercicios:editar')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['archivo'],
      properties: { archivo: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Adjunta un archivo al enunciado (dataset, esqueleto)',
    description:
      'Cuelga de la version vigente. Hasta cinco por version, 25 MiB cada uno; extensiones de una entrega mas `.csv`. ' +
      'El candidato invitado lo descarga con un enlace firmado de cinco minutos.',
  })
  @ApiNotFoundResponse({ description: 'El ejercicio no existe o no es de su empresa.' })
  adjuntar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() archivo: { originalname: string; buffer: Buffer; mimetype: string } | undefined,
    @Req() p: Peticion,
  ): Promise<ResumenVersion> {
    return this.ejercicios.adjuntar(id, archivo, solicitanteDe(p));
  }

  @Delete(':id')
  @RequierePermiso('ejercicios:editar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retira el ejercicio del banco',
    description:
      'No lo borra: deja de poder asociarse a vacantes nuevas, pero se conserva para que las evaluaciones ya emitidas sigan siendo auditables.',
  })
  retirar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<Ejercicio> {
    return this.ejercicios.retirar(id, solicitanteDe(p));
  }
}
