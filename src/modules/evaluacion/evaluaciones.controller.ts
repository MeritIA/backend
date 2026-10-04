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
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { ColaDeEvaluacionService } from './cola/cola-de-evaluacion.service.js';
import { EvaluacionService } from './evaluacion.service.js';
import { EvaluacionRespuesta, aRespuesta } from './dto/evaluacion.dto.js';
import { RequierePermiso, Rol, type UsuarioAutenticado } from '../autenticacion/index.js';
import { LimiteEvaluacion } from '../../common/rate-limit/index.js';
import type { Solicitante } from '../vacantes/index.js';

class MetricasDeColaRespuesta {
  @ApiProperty({ description: 'Esperando un worker libre.' }) enEspera!: number;
  @ApiProperty({ description: 'Evaluandose ahora.' }) activos!: number;
  @ApiProperty({ description: 'Esperando su siguiente reintento.' }) reprogramados!: number;
  @ApiProperty({ description: 'Agotaron los reintentos; se conservan 30 dias.' }) fallidos!: number;
  @ApiProperty({ description: 'Completados en las ultimas 24 horas.' }) completados!: number;
  @ApiProperty({ description: 'Si este proceso consume la cola.' }) workerActivo!: boolean;
}

class ReintentoRespuesta {
  @ApiProperty({ format: 'uuid' }) idEntrega!: string;
  @ApiProperty({ example: 'encolada' }) estado!: 'encolada';
}

interface Peticion {
  usuario: UsuarioAutenticado;
}

const solicitanteDe = (p: Peticion): Solicitante => ({
  id: p.usuario.id,
  rol: p.usuario.rol,
  idEmpresa: p.usuario.idEmpresa,
});

@ApiTags('evaluaciones')
@ApiBearerAuth('paseto')
@Controller({ path: 'evaluaciones', version: '1' })
export class EvaluacionesController {
  constructor(
    private readonly cola: ColaDeEvaluacionService,
    private readonly evaluacion: EvaluacionService,
  ) {}

  // Las rutas fijas van antes que las de parametro.

  @Get('cola')
  @RequierePermiso('evaluaciones:verCola')
  @ApiOperation({
    summary: 'Longitud y estado de la cola de evaluacion',
    description:
      'Para administradores. Una cola que crece sin parar indica que el servicio de IA no da abasto o esta caido.',
  })
  @ApiOkResponse({ type: MetricasDeColaRespuesta })
  metricas(): Promise<MetricasDeColaRespuesta> {
    return this.cola.metricas();
  }

  @Get('mias')
  @RequierePermiso('evaluaciones:leerPropias')
  @ApiOperation({
    summary: 'Evaluaciones del candidato autenticado',
    description: 'Con el desglose por criterio y la evidencia de cada puntaje.',
  })
  @ApiOkResponse({ type: [EvaluacionRespuesta] })
  async mias(@Req() p: Peticion): Promise<EvaluacionRespuesta[]> {
    // Sin el analisis: al candidato no se le dice que patron se detecto.
    return (await this.evaluacion.mias(solicitanteDe(p))).map((e) => aRespuesta(e));
  }

  @Get('vacante/:idVacante')
  @RequierePermiso('evaluaciones:leerDeLaVacante')
  @ApiOperation({
    summary: 'Evaluaciones de una vacante, de mayor a menor nota',
    description:
      'Solo para la empresa dueña de la vacante. Es la base del reporte del paquete 5.1.',
  })
  @ApiOkResponse({ type: [EvaluacionRespuesta] })
  @ApiNotFoundResponse({ description: 'La vacante no existe, o es de otra empresa.' })
  async deVacante(
    @Param('idVacante', new ParseUUIDPipe({ version: '4' })) idVacante: string,
    @Req() p: Peticion,
  ): Promise<EvaluacionRespuesta[]> {
    return (await this.evaluacion.deVacante(idVacante, solicitanteDe(p))).map((e) =>
      aRespuesta(e, { conSeguridad: true }),
    );
  }

  @Get('entrega/:idEntrega')
  @ApiOperation({
    summary: 'Evaluacion de una entrega',
    description:
      'Para el candidato que la entrego o para la empresa dueña de la vacante. Incluye la version de rubrica con la que se califico.',
  })
  @ApiOkResponse({ type: EvaluacionRespuesta })
  @ApiNotFoundResponse({
    description: 'No existe, aun no se evalua, o quien pregunta no tiene acceso.',
  })
  async deEntrega(
    @Param('idEntrega', new ParseUUIDPipe({ version: '4' })) idEntrega: string,
    @Req() p: Peticion,
  ): Promise<EvaluacionRespuesta> {
    const evaluacion = await this.evaluacion.deEntrega(idEntrega, solicitanteDe(p));
    return aRespuesta(evaluacion, { conSeguridad: p.usuario.rol !== Rol.Candidato });
  }

  @Post(':idEntrega/reintentar')
  @RequierePermiso('evaluaciones:reintentar')
  // Diez por minuto y por usuario: cada reintento gasta cuota del proveedor
  // (Plan de Seguridad §6.2, criterio del paquete 4.2).
  @LimiteEvaluacion()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Reintenta la evaluacion de una entrega fallida',
    description: 'No consume un intento del candidato: el fallo fue de la evaluacion, no suyo.',
  })
  @ApiAcceptedResponse({ type: ReintentoRespuesta })
  @ApiNotFoundResponse({ description: 'La entrega no existe.' })
  @ApiConflictResponse({ description: 'La entrega no esta en estado fallida.' })
  async reintentar(
    @Param('idEntrega', new ParseUUIDPipe({ version: '4' })) idEntrega: string,
    @Req() p: Peticion,
  ): Promise<ReintentoRespuesta> {
    await this.cola.reintentarFallida(idEntrega, p.usuario.id);
    return { idEntrega, estado: 'encolada' };
  }
}
