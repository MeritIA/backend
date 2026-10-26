import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { ReportesService } from './reportes.service.js';
import {
  IdentidadReveladaRespuesta,
  ReporteDeCandidatoRespuesta,
  ReporteDeVacanteRespuesta,
  RevelacionRegistradaRespuesta,
  aRespuestaDeCandidato,
  aRespuestaDeVacante,
} from './dto/reporte.dto.js';
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
 * Reportes consolidados (paquete 5.1).
 *
 * Las tres rutas cuelgan de una vacante. No existe un reporte "de un
 * candidato" suelto: ese mostraria su historial en otras empresas, y el tercer
 * criterio del paquete prohibe justo eso.
 *
 * Todas piden el permiso `reportes:verDeLaVacante` —reclutador o
 * administrador—, y ademas el servicio comprueba que la vacante sea de su
 * empresa. El permiso dice "este rol puede ver reportes"; el servicio dice
 * "pero solo los suyos". Hacen falta los dos.
 */
@ApiTags('reportes')
@ApiBearerAuth('paseto')
@Controller({ path: 'reportes', version: '1' })
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get('vacantes/:idVacante')
  @RequierePermiso('reportes:verDeLaVacante')
  @ApiOperation({
    summary: 'Reporte consolidado de una vacante',
    description:
      'Ranking de candidatos de mayor a menor nota, con sus cifras consolidadas y el promedio por criterio. El ranking lleva una fila por candidato, con la nota de su mejor intento.',
  })
  @ApiOkResponse({ type: ReporteDeVacanteRespuesta })
  @ApiNotFoundResponse({ description: 'La vacante no existe, o es de otra empresa.' })
  async deVacante(
    @Param('idVacante', new ParseUUIDPipe({ version: '4' })) idVacante: string,
    @Req() p: Peticion,
  ): Promise<ReporteDeVacanteRespuesta> {
    return aRespuestaDeVacante(await this.reportes.deVacante(idVacante, solicitanteDe(p)));
  }

  @Get('vacantes/:idVacante/candidatos/:idCandidato')
  @RequierePermiso('reportes:verDeLaVacante')
  @ApiOperation({
    summary: 'Detalle de un candidato en la vacante',
    description:
      'Todos sus intentos evaluados, cada uno con el desglose por criterio y la evidencia que sustenta el puntaje. Es de donde sale la nota del ranking.',
  })
  @ApiOkResponse({ type: ReporteDeCandidatoRespuesta })
  @ApiNotFoundResponse({
    description: 'La vacante es de otra empresa, o ese candidato no tiene evaluaciones en ella.',
  })
  async deCandidato(
    @Param('idVacante', new ParseUUIDPipe({ version: '4' })) idVacante: string,
    @Param('idCandidato', new ParseUUIDPipe({ version: '4' })) idCandidato: string,
    @Req() p: Peticion,
  ): Promise<ReporteDeCandidatoRespuesta> {
    return aRespuestaDeCandidato(
      await this.reportes.deCandidatoEnVacante(idVacante, idCandidato, solicitanteDe(p)),
    );
  }

  @Post('vacantes/:idVacante/candidatos/:idCandidato/revelar')
  @RequierePermiso('reportes:revelarIdentidad')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revela la identidad de un candidato del ranking',
    description:
      'El ranking se lee con alias para no sesgar la comparacion: es el proposito del producto. Esta accion devuelve el nombre y el correo, y DEJA RASTRO de quien la pidio y cuando. Es POST y no GET porque cambia algo: escribe en el registro de auditoria.',
  })
  @ApiOkResponse({ type: IdentidadReveladaRespuesta })
  @ApiNotFoundResponse({
    description: 'La vacante es de otra empresa, o ese candidato no participa en ella.',
  })
  async revelar(
    @Param('idVacante', new ParseUUIDPipe({ version: '4' })) idVacante: string,
    @Param('idCandidato', new ParseUUIDPipe({ version: '4' })) idCandidato: string,
    @Req() p: Peticion,
  ): Promise<IdentidadReveladaRespuesta> {
    const r = await this.reportes.revelarIdentidad(idVacante, idCandidato, solicitanteDe(p));
    return {
      alias: r.alias,
      idCandidato: r.idCandidato,
      nombre: r.nombre,
      correo: r.correo,
      reveladaEn: r.reveladaEn,
    };
  }

  @Get('vacantes/:idVacante/revelaciones')
  @RequierePermiso('reportes:verAuditoria')
  @ApiOperation({
    summary: 'Quien revelo que identidades en esta vacante',
    description:
      'El rastro que deja cada revelacion. Un registro de auditoria que nadie puede consultar no es una auditoria.',
  })
  @ApiOkResponse({ type: [RevelacionRegistradaRespuesta] })
  @ApiNotFoundResponse({ description: 'La vacante no existe, o es de otra empresa.' })
  async revelaciones(
    @Param('idVacante', new ParseUUIDPipe({ version: '4' })) idVacante: string,
    @Req() p: Peticion,
  ): Promise<RevelacionRegistradaRespuesta[]> {
    const registros = await this.reportes.revelacionesDe(idVacante, solicitanteDe(p));
    return registros.map((r) => ({
      alias: r.alias,
      idCandidato: r.idCandidato,
      idUsuario: r.idUsuario,
      reveladaEn: r.reveladaEn,
    }));
  }

  @Get('vacantes/:idVacante/exportar')
  @RequierePermiso('reportes:verDeLaVacante')
  @ApiOperation({
    summary: 'Exporta el ranking de la vacante en CSV',
    description:
      'Exportacion basica del entregable. Una fila por candidato; el desglose completo se consulta en el detalle. Las celdas van neutralizadas contra inyeccion de formulas.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'El CSV, como descarga.' })
  @ApiNotFoundResponse({ description: 'La vacante no existe, o es de otra empresa.' })
  async exportar(
    @Param('idVacante', new ParseUUIDPipe({ version: '4' })) idVacante: string,
    @Req() p: Peticion,
  ): Promise<StreamableFile> {
    const { nombre, contenido } = await this.reportes.csvDeVacante(idVacante, solicitanteDe(p));

    // StreamableFile en vez del objeto Response de Express: el nombre del
    // archivo se decide en ejecucion, y asi el controlador no se acopla al
    // framework HTTP como no lo hace ningun otro del proyecto.
    return new StreamableFile(Buffer.from(contenido, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${nombre}"`,
    });
  }
}
