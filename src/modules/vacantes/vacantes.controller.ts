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
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { VacantesService, type OfertaDelCatalogo, type Solicitante } from './vacantes.service.js';
import {
  AsignarCandidatoDto,
  AsociarEjerciciosDto,
  CrearVacanteDto,
  EditarVacanteDto,
  InvitacionAutomaticaDto,
  RechazarPostulacionDto,
} from './dto/index.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';
import type { ResumenVersion } from '../ejercicios/index.js';
import type { Vacante } from './entities/vacante.entity.js';
import type { Postulacion } from './entities/postulacion.entity.js';

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

  /**
   * VA ANTES DE `@Get(':id')` Y NO ES ESTILO.
   *
   * Nest resuelve las rutas en el orden en que se declaran. Si `:id` fuera
   * primero, `/vacantes/abiertas` entraria por ahi y el pipe de UUID lo
   * rechazaria con un 400 que habla de un identificador invalido, cuando lo que
   * pasa es que la ruta no se esta usando. Mover este metodo hacia abajo rompe
   * el catalogo sin tocarlo.
   */
  @Get('abiertas')
  @RequierePermiso('postulaciones:crear')
  @ApiOperation({
    summary: 'Catalogo de vacantes abiertas',
    description:
      'Las publicadas de empresas activas, con el nombre y el sector de quien publica. ' +
      'Cada fila dice si quien pregunta ya se postulo y si ya esta invitado, para que la pantalla sepa que ofrecer. ' +
      'NO ordena por afinidad: eso necesita un perfil de habilidades que el backend no tiene (ADR-0015).',
  })
  catalogoAbierto(@Req() p: Peticion): Promise<OfertaDelCatalogo[]> {
    return this.vacantes.catalogoAbierto(solicitanteDe(p));
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

  @Post(':id/candidatos/:idCandidato/contratar')
  @RequierePermiso('vacantes:editar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registra que a un candidato se le contrato',
    description:
      'El cierre del flujo de la pantalla A08, y la cifra "contratados" del panel. Deja quien lo registro y cuando. ' +
      'Se puede marcar con la vacante ya cerrada, que es el caso normal: primero se cierra el proceso y la contratacion se confirma despues. ' +
      'Es idempotente: volver a marcarlo no mueve la fecha, porque la primera es la que lee una auditoria.',
  })
  @ApiNotFoundResponse({
    description: 'La vacante no existe, no es de su empresa, o ese candidato no fue invitado.',
  })
  contratar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('idCandidato', new ParseUUIDPipe({ version: '4' })) idCandidato: string,
    @Req() p: Peticion,
  ): Promise<Vacante> {
    return this.vacantes.contratar(id, idCandidato, solicitanteDe(p));
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

  @Put(':id/invitacion-automatica')
  @RequierePermiso('postulaciones:decidir')
  @ApiOperation({
    summary: 'Enciende o apaga la invitacion automatica por afinidad (A04)',
    description:
      'Con `umbral`, entra solo quien lo alcanza; quien no tiene evidencia NO se rechaza, queda en revision para una persona. ' +
      'SIN `umbral` (nulo) acepta a todo el que se postule hasta el `cupo`: el reto pasa a ser el unico filtro. ' +
      'La automatizacion solo dice SI: nunca rechaza a nadie. El `cupo` limita lo automatico, no las invitaciones a mano (D-12). ' +
      'Al encenderla se procesan las postulaciones que ya estaban en revision, en orden de llegada, y la respuesta dice cuantas entraron.',
  })
  @ApiNotFoundResponse({ description: 'La vacante no existe o no es de su empresa.' })
  async configurarInvitacionAutomatica(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: InvitacionAutomaticaDto,
    @Req() p: Peticion,
  ): Promise<{ vacante: Vacante; aceptadas: number }> {
    return this.vacantes.configurarInvitacionAutomatica(
      id,
      { activa: datos.activa, umbral: datos.umbral ?? null, cupo: datos.cupo ?? null },
      solicitanteDe(p),
    );
  }

  // --- Postulaciones -------------------------------------------------------

  @Post(':id/postular')
  @RequierePermiso('postulaciones:crear')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Un candidato se postula a una vacante publicada',
    description:
      'Crea una solicitud EN REVISION. No da acceso al reto: lo que da acceso es la invitacion, ' +
      'y esa la crea el reclutador al aceptar. Si ya estaba invitado se responde 400 diciendo que puede empezar sin postularse.',
  })
  @ApiNotFoundResponse({
    description:
      'La vacante no existe, o no esta publicada. Se responde lo mismo en ambos casos: decir "esta en borrador" confirmaria que existe.',
  })
  @ApiConflictResponse({ description: 'Ya se habia postulado a esta vacante.' })
  postular(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<Postulacion> {
    return this.vacantes.postular(id, solicitanteDe(p));
  }

  @Get(':id/postulaciones')
  @RequierePermiso('postulaciones:leerDeLaVacante')
  @ApiOperation({
    summary: 'Los postulantes de una vacante',
    description:
      'Identificadores y estado, SIN nombre ni correo: es coherente con el ranking ciego, y deja al reclutador ' +
      'decidiendo sin saber quien es cada quien. Esa tension con A04 esta nombrada en el ADR-0015 y en la matriz §6.2.',
  })
  @ApiNotFoundResponse({ description: 'La vacante no existe o no es de su empresa.' })
  postulacionesDe(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<Postulacion[]> {
    return this.vacantes.postulacionesDe(id, solicitanteDe(p));
  }

  @Post(':id/postulaciones/:idCandidato/aceptar')
  @RequierePermiso('postulaciones:decidir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Acepta a un postulante y lo invita',
    description:
      'Las dos cosas en una transaccion: sin ella el candidato podria ver "aceptada" y seguir sin poder entregar. ' +
      'Una postulacion ya decidida devuelve 400: una decision sobre una persona no se reescribe.',
  })
  @ApiNotFoundResponse({
    description: 'La vacante no existe, no es de su empresa, o esa persona no se postulo.',
  })
  aceptarPostulacion(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('idCandidato', new ParseUUIDPipe({ version: '4' })) idCandidato: string,
    @Req() p: Peticion,
  ): Promise<Postulacion> {
    return this.vacantes.aceptarPostulacion(id, idCandidato, solicitanteDe(p));
  }

  @Post(':id/postulaciones/:idCandidato/rechazar')
  @RequierePermiso('postulaciones:decidir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rechaza a un postulante, con el motivo que va a leer',
    description:
      'El motivo es obligatorio y minimo 20 caracteres: es lo unico que el candidato recibe cuando no avanza, ' +
      'y es el cimiento del "feedback de por que no avanzo" que pide el diagrama del equipo.',
  })
  @ApiNotFoundResponse({
    description: 'La vacante no existe, no es de su empresa, o esa persona no se postulo.',
  })
  rechazarPostulacion(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('idCandidato', new ParseUUIDPipe({ version: '4' })) idCandidato: string,
    @Body() datos: RechazarPostulacionDto,
    @Req() p: Peticion,
  ): Promise<Postulacion> {
    return this.vacantes.rechazarPostulacion(id, idCandidato, datos.motivo, solicitanteDe(p));
  }
}
