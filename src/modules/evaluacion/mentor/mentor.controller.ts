import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RequierePermiso, type UsuarioAutenticado } from '../../autenticacion/index.js';
import { LimiteEvaluacion } from '../../../common/rate-limit/index.js';
import { MentorService } from './mentor.service.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}

class TurnoDto {
  @ApiProperty({ enum: ['candidato', 'mentor'] })
  @IsIn(['candidato', 'mentor'])
  rol!: 'candidato' | 'mentor';

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  texto!: string;
}

class PreguntaAlMentorDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @Length(1, 500)
  pregunta!: string;

  @ApiProperty({
    type: [TurnoDto],
    description: 'La conversacion hasta ahora; se usan los ultimos 6 turnos.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TurnoDto)
  historial!: TurnoDto[];
}

class RespuestaDelMentor {
  @ApiProperty() respuesta!: string;
  @ApiProperty({ type: [String] }) sugerencias!: string[];
}

class CriterioDelPerfilRespuesta {
  @ApiProperty() nombre!: string;
  @ApiProperty() porcentaje!: number;
  @ApiProperty() veces!: number;
}

class FlojoRespuesta {
  @ApiProperty() criterio!: string;
  @ApiProperty() porcentaje!: number;
  @ApiProperty() evidencia!: string;
}

class RecienteRespuesta {
  @ApiProperty() reto!: string;
  @ApiProperty() nota!: number;
  @ApiProperty({ type: FlojoRespuesta, required: false }) flojo?: FlojoRespuesta;
}

class ContextoDelMentorRespuesta {
  @ApiProperty() totalEvaluaciones!: number;
  @ApiProperty() promedio!: number;
  @ApiProperty({ type: [CriterioDelPerfilRespuesta] }) perfil!: CriterioDelPerfilRespuesta[];
  @ApiProperty({ type: [RecienteRespuesta] }) recientes!: RecienteRespuesta[];
}

@ApiTags('mentor')
@ApiBearerAuth('paseto')
@Controller({ path: 'mentor', version: '1' })
export class MentorController {
  constructor(private readonly mentor: MentorService) {}

  @Get('contexto')
  @RequierePermiso('mentor:usar')
  @ApiOperation({
    summary: 'Lo que el mentor sabe de ti',
    description:
      'El resumen exacto que se le entrega al mentor: totales, promedio por criterio y las tres evaluaciones mas recientes. Nada mas sale hacia la IA.',
  })
  @ApiOkResponse({ type: ContextoDelMentorRespuesta })
  async contexto(@Req() p: Peticion): Promise<ContextoDelMentorRespuesta> {
    return (await this.mentor.contexto(p.usuario)) as ContextoDelMentorRespuesta;
  }

  @Post('preguntar')
  @LimiteEvaluacion()
  @RequierePermiso('mentor:usar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hace una pregunta al mentor sobre tus evaluaciones' })
  @ApiOkResponse({ type: RespuestaDelMentor })
  @ApiForbiddenResponse({ description: 'Revocaste el permiso de calificacion por IA.' })
  @ApiServiceUnavailableResponse({ description: 'El servicio de IA no esta disponible.' })
  async preguntar(@Body() d: PreguntaAlMentorDto, @Req() p: Peticion): Promise<RespuestaDelMentor> {
    const r = await this.mentor.preguntar(d.pregunta, d.historial, p.usuario);
    return { respuesta: r.respuesta, sugerencias: [...r.sugerencias] };
  }
}
