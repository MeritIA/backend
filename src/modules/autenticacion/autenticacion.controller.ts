import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AutenticacionService } from './autenticacion.service.js';
import { LoginDto, RegistroDto, RenovarDto, SesionRespuesta } from './dto/index.js';
import { Publico, type UsuarioAutenticado } from './guardias/autenticacion.guard.js';
import { LimiteLogin } from '../../common/rate-limit/index.js';

@ApiTags('autenticacion')
@Controller({ path: 'autenticacion', version: '1' })
export class AutenticacionController {
  constructor(private readonly autenticacion: AutenticacionService) {}

  @Publico()
  @LimiteLogin()
  @Post('registro')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registra un candidato',
    description:
      'Crea una cuenta de candidato y devuelve la sesion. El rol no se puede elegir: el registro publico solo crea candidatos, y enviar un campo `rol` devuelve 400.',
  })
  @ApiBody({ type: RegistroDto })
  @ApiResponse({ status: 201, type: SesionRespuesta })
  @ApiResponse({
    status: 400,
    description: 'Cuerpo invalido. El detalle viene agrupado por campo.',
  })
  @ApiResponse({ status: 409, description: 'Ya existe una cuenta con ese correo.' })
  @ApiTooManyRequestsResponse({
    description: 'Limite de peticiones superado. Ver cabecera Retry-After.',
  })
  registrar(@Body() datos: RegistroDto): Promise<SesionRespuesta> {
    return this.autenticacion.registrar(datos);
  }

  @Publico()
  @LimiteLogin()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inicia sesion',
    description:
      'Devuelve un token de acceso y uno de renovacion. Limitado a diez intentos por minuto. La respuesta de error no distingue entre correo inexistente y contrasena incorrecta, para no permitir averiguar que correos estan registrados.',
  })
  @ApiResponse({ status: 200, type: SesionRespuesta })
  @ApiUnauthorizedResponse({ description: 'Credenciales invalidas.' })
  @ApiTooManyRequestsResponse({
    description: 'Limite de peticiones superado. Ver cabecera Retry-After.',
  })
  iniciarSesion(@Body() datos: LoginDto): Promise<SesionRespuesta> {
    return this.autenticacion.iniciarSesion(datos);
  }

  @Publico()
  @Post('renovar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renueva la sesion',
    description:
      'Entrega un token de acceso nuevo a partir de uno de renovacion vigente. Un token de acceso no sirve aqui.',
  })
  @ApiResponse({ status: 200, type: SesionRespuesta })
  @ApiUnauthorizedResponse({ description: 'Token de renovacion invalido o vencido.' })
  renovar(@Body() datos: RenovarDto): Promise<SesionRespuesta> {
    return this.autenticacion.renovar(datos.tokenDeRenovacion);
  }

  @Get('yo')
  @ApiBearerAuth('paseto')
  @ApiOperation({
    summary: 'Devuelve la identidad de la sesion actual',
    description: 'Sirve al frontend para saber quien esta autenticado y con que rol.',
  })
  @ApiUnauthorizedResponse({ description: 'Token de acceso invalido o vencido.' })
  yo(@Req() peticion: { usuario: UsuarioAutenticado }): UsuarioAutenticado {
    return peticion.usuario;
  }

  @Post('cerrar-sesiones')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('paseto')
  @ApiOperation({
    summary: 'Cierra la sesion en todos los dispositivos',
    description:
      'Invalida todos los tokens emitidos hasta este momento. Es lo que permite cortar un token robado antes de que expire.',
  })
  @ApiUnauthorizedResponse({ description: 'Token de acceso invalido o vencido.' })
  async cerrarSesiones(@Req() peticion: { usuario: UsuarioAutenticado }): Promise<void> {
    await this.autenticacion.cerrarTodasLasSesiones(peticion.usuario.id);
  }
}
