import {
  Body,
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
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EmpresasService } from './empresas.service.js';
import {
  CrearEmpresaDto,
  CrearUsuarioDeEmpresaDto,
  EmpresaRespuesta,
  UsuarioDeEmpresaRespuesta,
} from './dto/index.js';
import { RequierePermiso } from './guardias/roles.guard.js';
import type { SectorEmpresa } from './dominio/sector.js';
import type { UsuarioAutenticado } from './guardias/autenticacion.guard.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}

@ApiTags('empresas')
@ApiBearerAuth('paseto')
@Controller({ path: 'empresas', version: '1' })
export class EmpresasController {
  constructor(private readonly empresas: EmpresasService) {}

  @Post()
  @RequierePermiso('empresas:administrar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea una empresa cliente',
    description:
      'Solo un administrador de la plataforma (sin empresa propia). La empresa es la frontera de los datos: sus vacantes, ejercicios, entregas y reportes no los ve nadie de otra.',
  })
  @ApiCreatedResponse({ type: EmpresaRespuesta })
  @ApiForbiddenResponse({ description: 'Un administrador de una empresa no crea otras.' })
  @ApiConflictResponse({ description: 'Ya existe una empresa con ese nombre.' })
  async crear(@Body() datos: CrearEmpresaDto, @Req() p: Peticion): Promise<EmpresaRespuesta> {
    return aRespuesta(await this.empresas.crear(datos, p.usuario));
  }

  @Get()
  @RequierePermiso('empresas:administrar')
  @ApiOperation({
    summary: 'Lista las empresas visibles',
    description: 'Un administrador de la plataforma las ve todas; el de una empresa, solo la suya.',
  })
  @ApiOkResponse({ type: [EmpresaRespuesta] })
  async listar(@Req() p: Peticion): Promise<EmpresaRespuesta[]> {
    return (await this.empresas.listar(p.usuario)).map(aRespuesta);
  }

  @Post(':id/usuarios')
  @RequierePermiso('usuarios:administrar')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea un reclutador o administrador en la empresa',
    description:
      'Es el alta del paquete 5.3. El registro publico solo crea candidatos; reclutadores y administradores se crean por aqui.',
  })
  @ApiCreatedResponse({ type: UsuarioDeEmpresaRespuesta })
  @ApiNotFoundResponse({ description: 'La empresa no existe, o no es la del administrador.' })
  @ApiConflictResponse({ description: 'Ya existe una cuenta con ese correo.' })
  async crearUsuario(
    @Param('id', new ParseUUIDPipe({ version: '4' })) idEmpresa: string,
    @Body() datos: CrearUsuarioDeEmpresaDto,
    @Req() p: Peticion,
  ): Promise<UsuarioDeEmpresaRespuesta> {
    const usuario = await this.empresas.crearUsuario(idEmpresa, datos, p.usuario);
    return {
      id: usuario.id,
      correo: usuario.correo,
      nombreCompleto: usuario.nombreCompleto,
      rol: usuario.rol,
      idEmpresa,
    };
  }
}

function aRespuesta(e: {
  id: string;
  nombre: string;
  sector: SectorEmpresa;
  nit: string | null;
  activa: boolean;
  creadaEn: Date;
}): EmpresaRespuesta {
  return {
    id: e.id,
    nombre: e.nombre,
    sector: e.sector,
    nit: e.nit,
    activa: e.activa,
    creadaEn: e.creadaEn,
  };
}
