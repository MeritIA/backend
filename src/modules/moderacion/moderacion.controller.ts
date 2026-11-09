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
} from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ModeracionService } from './moderacion.service.js';
import { CrearModeradorDto, DecidirCasoDto, DisputarCasoDto } from './dto/moderacion.dto.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}

class FiltroDeBandejaDto {
  @IsOptional()
  @IsIn(['abierto', 'restaurado', 'confirmado'])
  estado?: 'abierto' | 'restaurado' | 'confirmado';
}

/**
 * Moderacion de evaluaciones (Flujo C).
 *
 * Los casos llevan alias, nunca nombre ni correo del candidato. Ver el servicio.
 */
@ApiTags('moderacion')
@ApiBearerAuth('paseto')
@Controller({ path: 'moderacion', version: '1' })
export class ModeracionController {
  constructor(private readonly moderacion: ModeracionService) {}

  // --- Candidato ---

  @Get('mis-casos')
  @RequierePermiso('moderacion:verPropios')
  @ApiOperation({
    summary: 'Mis evaluaciones en revision o ya revisadas (B19 a B21)',
    description:
      'Estado de cada caso y, una vez decidido, lo que escribio el moderador. `puedeDisputar` indica si queda la disputa ante otro moderador.',
  })
  misCasos(@Req() p: Peticion) {
    return this.moderacion.misCasos(p.usuario.id);
  }

  @Post('casos/:id/disputar')
  @RequierePermiso('moderacion:verPropios')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Disputa una descalificacion confirmada (B21)',
    description: 'Una sola vez por caso. La decide otro moderador, distinto del que confirmo.',
  })
  @ApiNotFoundResponse({ description: 'El caso no existe o no es suyo.' })
  async disputar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: DisputarCasoDto,
    @Req() p: Peticion,
  ) {
    const caso = await this.moderacion.disputar(id, p.usuario.id, datos.explicacion);
    return { id: caso.id, estado: caso.estado, venceEn: caso.venceEn };
  }

  // --- Moderador ---

  @Get('casos')
  @RequierePermiso('moderacion:revisar')
  @ApiOperation({
    summary: 'Bandeja de casos (C25)',
    description:
      'Por defecto los abiertos, ordenados por lo que vence antes. Con alias, sin identidad.',
  })
  bandeja(@Query() filtro: FiltroDeBandejaDto) {
    return this.moderacion.bandeja(filtro.estado);
  }

  @Get('casos/:id')
  @RequierePermiso('moderacion:revisar')
  @ApiOperation({
    summary: 'Revision de un caso (C26)',
    description: 'Evidencia de la evaluacion y sus banderas.',
  })
  detalle(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.moderacion.detalle(id);
  }

  @Post('casos/:id/decidir')
  @RequierePermiso('moderacion:revisar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decide un caso (C26)',
    description:
      '`confirmar` descalifica la evaluacion; `restaurar` la deja. La justificacion es obligatoria y la lee el candidato.',
  })
  async decidir(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: DecidirCasoDto,
    @Req() p: Peticion,
  ) {
    const caso = await this.moderacion.decidir(
      id,
      datos.decision,
      datos.justificacion,
      p.usuario.id,
    );
    return { id: caso.id, estado: caso.estado, decididoEn: caso.decididoEn };
  }

  @Get('metricas')
  @RequierePermiso('moderacion:metricas')
  @ApiOperation({
    summary: 'Metricas del modelo y de la moderacion (C27)',
    description:
      'Casos por origen y estado, tasa de falsos positivos de las marcas antifraude, cobertura del muestreo, tiempo de resolucion y casos vencidos. No incluye tasas por grupo: no se recogen datos demograficos.',
  })
  metricas() {
    return this.moderacion.metricas();
  }

  // --- Administracion ---

  @Post('moderadores')
  @RequierePermiso('moderacion:gestionar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea un moderador',
    description: 'Personal de la plataforma, sin empresa. Solo un administrador.',
  })
  crearModerador(@Body() datos: CrearModeradorDto) {
    return this.moderacion.crearModerador(datos);
  }
}
