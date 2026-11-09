import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AutenticacionService } from './autenticacion.service.js';
import {
  EliminarCuentaDto,
  LoginDto,
  RegistrarEmpresaDto,
  RegistroDto,
  RenovarDto,
  SesionRespuesta,
} from './dto/index.js';
import { Publico, type UsuarioAutenticado } from './guardias/autenticacion.guard.js';
import { LimiteLogin } from '../../common/rate-limit/index.js';
import { COOKIE_RENOVACION, TipoCliente } from './dominio/tipo-cliente.js';
import { entregarSesion, limpiarCookies, type RespuestaConCookies } from './entrega-de-sesion.js';

interface Peticion {
  usuario: UsuarioAutenticado;
  cookies?: Record<string, string | undefined>;
}

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
      'Crea una cuenta de candidato. El rol no se puede elegir: el registro publico solo crea candidatos, y enviar un campo `rol` devuelve 400.\n\n' +
      'Los tokens se entregan segun el campo `cliente`: en **web** (por omision) viajan en cookies HttpOnly y NO aparecen en el cuerpo; en **apk** vienen en el cuerpo para guardarlos en el KeyStore.',
  })
  @ApiBody({ type: RegistroDto })
  @ApiResponse({ status: 201, type: SesionRespuesta })
  @ApiResponse({
    status: 400,
    description: 'Cuerpo invalido. El detalle viene agrupado por campo.',
  })
  @ApiResponse({ status: 409, description: 'Ya existe una cuenta con ese correo.' })
  @ApiTooManyRequestsResponse({ description: 'Limite superado. Ver cabecera Retry-After.' })
  async registrar(
    @Body() datos: RegistroDto,
    @Res({ passthrough: true }) respuesta: RespuestaConCookies,
  ): Promise<SesionRespuesta> {
    const sesion = await this.autenticacion.registrar(datos);
    return entregarSesion(sesion, datos.cliente ?? TipoCliente.Web, respuesta);
  }

  @Publico()
  @LimiteLogin()
  @Post('registro-empresa')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registra una empresa y su primer administrador',
    description:
      'Auto-registro de la pantalla A01. Crea la empresa y su administrador en un solo acto y abre la sesion. El NIT es obligatorio y se comprueba por su digito de verificacion; la validacion contra la Camara de Comercio no existe todavia.',
  })
  @ApiBody({ type: RegistrarEmpresaDto })
  @ApiResponse({ status: 201, type: SesionRespuesta })
  @ApiResponse({ status: 400, description: 'Cuerpo invalido o NIT que no cuadra.' })
  @ApiResponse({ status: 409, description: 'El NIT, el nombre o el correo ya existen.' })
  @ApiTooManyRequestsResponse({ description: 'Limite superado. Ver cabecera Retry-After.' })
  async registrarEmpresa(
    @Body() datos: RegistrarEmpresaDto,
    @Res({ passthrough: true }) respuesta: RespuestaConCookies,
  ): Promise<SesionRespuesta> {
    const sesion = await this.autenticacion.registrarEmpresa(datos);
    return entregarSesion(sesion, datos.cliente ?? TipoCliente.Web, respuesta);
  }

  @Publico()
  @LimiteLogin()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inicia sesion',
    description:
      'Limitado a diez intentos por minuto. La respuesta de error no distingue entre correo inexistente y contrasena incorrecta, para no permitir averiguar que correos estan registrados.\n\n' +
      'En **web** el token va en cookie HttpOnly y no es legible desde JavaScript; en **apk** viene en el cuerpo.',
  })
  @ApiResponse({ status: 200, type: SesionRespuesta })
  @ApiUnauthorizedResponse({ description: 'Credenciales invalidas.' })
  @ApiTooManyRequestsResponse({ description: 'Limite superado. Ver cabecera Retry-After.' })
  async iniciarSesion(
    @Body() datos: LoginDto,
    @Res({ passthrough: true }) respuesta: RespuestaConCookies,
  ): Promise<SesionRespuesta> {
    const sesion = await this.autenticacion.iniciarSesion(datos);
    return entregarSesion(sesion, datos.cliente ?? TipoCliente.Web, respuesta);
  }

  @Publico()
  @Post('renovar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renueva la sesion',
    description:
      'Entrega un token de acceso nuevo. En **web** el token de renovacion se lee de la cookie y no hay que enviarlo; en **apk** va en el cuerpo. Un token de acceso no sirve aqui.',
  })
  @ApiResponse({ status: 200, type: SesionRespuesta })
  @ApiUnauthorizedResponse({ description: 'Token de renovacion invalido o vencido.' })
  async renovar(
    @Body() datos: RenovarDto,
    @Req() peticion: Peticion,
    @Res({ passthrough: true }) respuesta: RespuestaConCookies,
  ): Promise<SesionRespuesta> {
    // El cuerpo (APK) o la cookie (web). Si no hay ninguno, no hay que renovar.
    const token = datos.tokenDeRenovacion ?? peticion.cookies?.[COOKIE_RENOVACION];
    if (!token) {
      throw new UnauthorizedException('Falta el token de renovacion.');
    }

    const sesion = await this.autenticacion.renovar(token);
    return entregarSesion(sesion, datos.cliente ?? TipoCliente.Web, respuesta);
  }

  @Get('yo')
  @ApiBearerAuth('paseto')
  @ApiCookieAuth('meritia_acceso')
  @ApiOperation({
    summary: 'Devuelve la identidad de la sesion actual',
    description:
      'Sirve al frontend para saber quien esta autenticado y con que rol. Acepta el token por cabecera Authorization o por la cookie HttpOnly.',
  })
  @ApiUnauthorizedResponse({ description: 'Token de acceso invalido o vencido.' })
  yo(@Req() peticion: Peticion): UsuarioAutenticado {
    return peticion.usuario;
  }

  @Delete('cuenta')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('paseto')
  @ApiCookieAuth('meritia_acceso')
  @ApiOperation({
    summary: 'Elimina mi cuenta (Ley 1581)',
    description:
      'Pide la contrasena. Anonimiza la cuenta, cierra todas las sesiones y borra las fotos de verificacion y las postulaciones. ' +
      'Las entregas y evaluaciones ya hechas se conservan sin tu nombre, porque son parte del expediente de la empresa. No se deshace.',
  })
  @ApiUnauthorizedResponse({ description: 'La contrasena no es correcta.' })
  async eliminarCuenta(
    @Body() datos: EliminarCuentaDto,
    @Req() peticion: Peticion,
    @Res({ passthrough: true }) respuesta: RespuestaConCookies,
  ): Promise<void> {
    await this.autenticacion.eliminarCuenta(peticion.usuario.id, datos.contrasena);
    limpiarCookies(respuesta);
  }

  @Post('cerrar-sesiones')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('paseto')
  @ApiCookieAuth('meritia_acceso')
  @ApiOperation({
    summary: 'Cierra la sesion en todos los dispositivos',
    description:
      'Invalida todos los tokens emitidos hasta este momento y borra las cookies de este navegador. Es lo que permite cortar un token robado antes de que expire.',
  })
  @ApiUnauthorizedResponse({ description: 'Token de acceso invalido o vencido.' })
  async cerrarSesiones(
    @Req() peticion: Peticion,
    @Res({ passthrough: true }) respuesta: RespuestaConCookies,
  ): Promise<void> {
    await this.autenticacion.cerrarTodasLasSesiones(peticion.usuario.id);
    // Sin esto, el navegador seguiria mandando una cookie ya invalidada en cada
    // peticion y recibiendo 401 sin entender por que.
    limpiarCookies(respuesta);
  }
}
