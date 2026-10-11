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
} from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EjerciciosService, type Solicitante } from './ejercicios.service.js';
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
