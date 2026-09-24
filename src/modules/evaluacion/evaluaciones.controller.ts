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
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';

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

@ApiTags('evaluaciones')
@ApiBearerAuth('paseto')
@Controller({ path: 'evaluaciones', version: '1' })
export class EvaluacionesController {
  constructor(private readonly cola: ColaDeEvaluacionService) {}

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

  @Post(':idEntrega/reintentar')
  @RequierePermiso('evaluaciones:reintentar')
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
    @Req() p: { usuario: UsuarioAutenticado },
  ): Promise<ReintentoRespuesta> {
    await this.cola.reintentarFallida(idEntrega, p.usuario.id);
    return { idEntrega, estado: 'encolada' };
  }
}
