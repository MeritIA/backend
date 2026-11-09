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
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { HabilidadesService } from './habilidades.service.js';
import { AnadirAliasDto, CrearHabilidadDto } from './dto/index.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';
import type { Habilidad } from './entities/habilidad.entity.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}

/**
 * El vocabulario de habilidades (ADR-0017).
 *
 * LO ADMINISTRA PLATAFORMA, NO CADA EMPRESA
 *
 * Si cada empresa tuviera su vocabulario, dos empresas que piden lo mismo
 * seguirian midiendo habilidades distintas y el perfil del candidato dejaria de
 * ser transversal, que es justo lo que lo hace valer. El permiso de escritura es
 * de administrador; el de lectura, de cualquiera autenticado, porque un
 * reclutador necesita ver el catalogo para escribir sus criterios con los
 * nombres que ya existen.
 */
@ApiTags('habilidades')
@ApiBearerAuth('paseto')
@Controller({ path: 'habilidades', version: '1' })
export class HabilidadesController {
  constructor(private readonly habilidades: HabilidadesService) {}

  @Get()
  @RequierePermiso('habilidades:leer')
  @ApiOperation({
    summary: 'El vocabulario de habilidades, con sus alias',
    description:
      'Lo lee cualquiera autenticado: un reclutador necesita ver que nombres ya existen antes de escribir los criterios de su rubrica, ' +
      'y escribirlos con el nombre del catalogo es lo que hace que la afinidad acierte.',
  })
  @ApiQuery({
    name: 'incluirRetiradas',
    required: false,
    description: 'Las retiradas ya no se ofrecen, pero siguen resolviendo lo que ya se escribio.',
  })
  catalogo(@Query('incluirRetiradas') incluirRetiradas?: string): Promise<Habilidad[]> {
    return this.habilidades.catalogo(incluirRetiradas === 'true');
  }

  @Post()
  @RequierePermiso('habilidades:administrar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Anade una habilidad al vocabulario',
    description:
      'Cambia el perfil de habilidades de TODO EL MUNDO y, con el, las afinidades: se calculan en vivo, sin copia guardada. ' +
      'Eso es lo que se quiere --unir dos nombres es un arreglo-- pero conviene saberlo antes de pulsar. ' +
      'Las invitaciones automaticas ya emitidas no se mueven: guardan la afinidad con la que se decidieron.',
  })
  @ApiConflictResponse({
    description:
      'La habilidad o uno de sus alias ya existe, o el nombre ya es alias de otra habilidad: un nombre no puede resolver a dos sitios.',
  })
  crear(@Body() datos: CrearHabilidadDto, @Req() p: Peticion): Promise<Habilidad> {
    return this.habilidades.crear(datos, p.usuario);
  }

  @Post(':id/alias')
  @RequierePermiso('habilidades:administrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Anade otra forma de escribir una habilidad',
    description:
      'Es la pieza que hace que el vocabulario sirva: sin alias, el catalogo solo acertaria cuando el reclutador escribiera exactamente el nombre canonico.',
  })
  @ApiConflictResponse({
    description: 'Ese termino ya es alias de alguna habilidad, o es el nombre canonico de otra.',
  })
  anadirAlias(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() datos: AnadirAliasDto,
    @Req() p: Peticion,
  ): Promise<Habilidad> {
    return this.habilidades.anadirAlias(id, datos, p.usuario);
  }

  @Delete(':id/alias/:termino')
  @RequierePermiso('habilidades:administrar')
  @ApiOperation({ summary: 'Quita un alias de una habilidad' })
  quitarAlias(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('termino') termino: string,
    @Req() p: Peticion,
  ): Promise<Habilidad> {
    return this.habilidades.quitarAlias(id, termino, p.usuario);
  }

  @Delete(':id')
  @RequierePermiso('habilidades:administrar')
  @ApiOperation({
    summary: 'Retira una habilidad del vocabulario',
    description:
      'No la borra: sigue resolviendo los nombres que ya se escribieron. Borrarla cambiaria el perfil de los candidatos que ya la tenian, ' +
      'y un perfil que se mueve porque alguien edito un catalogo no es auditable.',
  })
  retirar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() p: Peticion,
  ): Promise<Habilidad> {
    return this.habilidades.retirar(id, p.usuario);
  }
}
