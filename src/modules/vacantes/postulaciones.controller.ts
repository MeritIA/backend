import { Controller, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VacantesService, type Solicitante } from './vacantes.service.js';
import { RequierePermiso, type UsuarioAutenticado } from '../autenticacion/index.js';
import type { Postulacion } from './entities/postulacion.entity.js';

interface Peticion {
  usuario: UsuarioAutenticado;
}

const solicitanteDe = (p: Peticion): Solicitante => ({
  id: p.usuario.id,
  rol: p.usuario.rol,
  idEmpresa: p.usuario.idEmpresa,
});

/**
 * Las postulaciones vistas desde el candidato.
 *
 * POR QUE UN CONTROLADOR APARTE Y NO UNA RUTA MAS EN `vacantes`
 *
 * «Mis postulaciones» no cuelga de ninguna vacante: es una lista de la persona,
 * que atraviesa todas las ofertas a las que pidio entrar. Colgarla de
 * `/vacantes/...` obligaria a inventar un identificador de vacante que no
 * existe en esa pregunta.
 *
 * Vive en el modulo de vacantes porque el dato es de aqui. Lo que cambia es la
 * ruta, no el dueño.
 */
@ApiTags('postulaciones')
@ApiBearerAuth('paseto')
@Controller({ path: 'postulaciones', version: '1' })
export class PostulacionesController {
  constructor(private readonly vacantes: VacantesService) {}

  @Get('mias')
  @RequierePermiso('postulaciones:leerPropias')
  @ApiOperation({
    summary: 'Las postulaciones del propio candidato',
    description:
      'Cada una con su vacante y su estado. Si fue rechazada trae el motivo, que es lo que el candidato tiene derecho a leer. ' +
      'No hace falta filtrar por nada: solo devuelve las suyas, salga de donde salga el identificador.',
  })
  mias(@Req() p: Peticion): Promise<Postulacion[]> {
    return this.vacantes.misPostulaciones(solicitanteDe(p));
  }
}
