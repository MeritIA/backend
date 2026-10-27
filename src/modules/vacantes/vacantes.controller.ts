import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { VacantesService, type Solicitante } from './vacantes.service.js';
import {
  AsignarCandidatoDto,
  AsociarEjerciciosDto,
  CrearVacanteDto,
  EditarVacanteDto,
} from './dto/index.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';
import type { ResumenVersion } from '../ejercicios/index.js';
import type { Vacante } from './entities/vacante.entity.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}

const solicitanteDe = (p: Peticion): Solicitante => ({
  id: p.usuario.id,
  rol: p.usuario.rol,
  idEmpresa: p.usuario.idEmpresa,
});

@ApiTags('vacantes')
@ApiBearerAuth('paseto')
@Controller({ path: 'vacantes', version: '1' })
export class VacantesController {
  constructor(private readonly vacantes: VacantesService) {}

  @Post()
  @RequierePermiso('vacantes:crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea una vacante en borrador',
    description:
      'La vacante nace en borrador y a nombre de quien la crea. El estado y el reclutador no se aceptan en el cuerpo: enviarlos devuelve 400.',
  })
  crear(@Body() datos: CrearVacanteDto, @Req() p: Peticion): Promise<Vacante> {
    return this.vacantes.crear(datos, solicitanteDe(p));
  }

  @Get()
  @RequierePermiso('vacantes:leer')
  @ApiOperation({
    summary: 'Lista las vacantes visibles para quien pregunta',
    description:
      'Un reclutador ve las suyas, no las de sus colegas. Un candidato ve unicamente las publicadas a las que fue invitado. Un administrador las ve todas.',
  })
  listar(@Req() p: Peticion): Promise<Vacante[]> {
    return this.vacantes.listar(solicitanteDe(p));
  }

  @Get(':id')
  @RequierePermiso('vacantes:leer')
  @ApiOperation({ summary: 'Consulta una vacante' })
  @ApiNotFoundResponse({
    description:
      'La vacante no existe, o quien pregunta no tiene acceso a ella. Se responde lo mismo en ambos casos: distinguirlos permitiria averiguar que vacantes existen probando identificadores.',
  })
  obtener(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<Vacante> {
    return this.vacantes.obtenerPara(id, solicitanteDe(p));
  }

  @Get(':id/ejercicios')
  @RequierePermiso('vacantes:leer')
  @ApiOperation({
    summary: 'Enunciado y rubrica de los ejercicios de la vacante',
    description:
      'Lo que necesita quien va a resolver el reto: el enunciado y los criterios con sus pesos. ' +
      'Es la unica forma en que un candidato invitado lee su ejercicio, porque el banco de ejercicios ' +
      'de la empresa no es visible para el. Devuelve la version vigente de cada uno, que es la misma ' +
      'contra la que se califica: la rubrica es publica y es igual para todos los finalistas.',
  })
  @ApiNotFoundResponse({
    description:
      'La vacante no existe, o quien pregunta no tiene acceso a ella. Un candidato solo accede si fue invitado y la vacante ya esta publicada.',
  })
  ejercicios(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<ResumenVersion[]> {
    return this.vacantes.ejerciciosDeLaVacante(id, solicitanteDe(p));
  }

  @Patch(':id')
  @RequierePermiso('vacantes:editar')
  @ApiOperation({
    summary: 'Edita una vacante',
    description: 'Solo el reclutador dueno. Una vacante cerrada no se edita.',
  })
  @ApiForbiddenResponse({ description: 'El rol no permite editar vacantes.' })
  editar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: EditarVacanteDto,
    @Req() p: Peticion,
  ): Promise<Vacante> {
    return this.vacantes.editar(id, datos, solicitanteDe(p));
  }

  @Put(':id/ejercicios')
  @RequierePermiso('vacantes:editar')
  @ApiOperation({
    summary: 'Define los ejercicios de la vacante',
    description:
      'Reemplaza la lista completa. Solo mientras la vacante es un borrador: cambiarlos despues dejaria a dos candidatos del mismo proceso resolviendo pruebas distintas, y sus resultados dejarian de ser comparables.',
  })
  asociarEjercicios(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: AsociarEjerciciosDto,
    @Req() p: Peticion,
  ): Promise<Vacante> {
    return this.vacantes.asociarEjercicios(id, datos.idsDeEjercicios, solicitanteDe(p));
  }

  @Post(':id/candidatos')
  @RequierePermiso('vacantes:editar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Invita a un candidato',
    description: 'Es lo que le da acceso a ver la vacante y a resolver sus ejercicios.',
  })
  asignarCandidato(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: AsignarCandidatoDto,
    @Req() p: Peticion,
  ): Promise<Vacante> {
    return this.vacantes.asignarCandidato(id, datos.idCandidato, solicitanteDe(p));
  }

  @Post(':id/publicar')
  @RequierePermiso('vacantes:editar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publica la vacante',
    description:
      'Exige al menos un ejercicio asociado: publicarla sin ninguno dejaria a los candidatos invitados sin nada que resolver.',
  })
  publicar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<Vacante> {
    return this.vacantes.publicar(id, solicitanteDe(p));
  }

  @Post(':id/cerrar')
  @RequierePermiso('vacantes:editar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cierra la vacante',
    description: 'No se reabre: un proceso cerrado debe seguir siendo auditable tal como termino.',
  })
  cerrar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<Vacante> {
    return this.vacantes.cerrar(id, solicitanteDe(p));
  }
}
