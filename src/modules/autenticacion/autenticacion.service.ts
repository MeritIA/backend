import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from './entities/usuario.entity.js';
import { Rol } from './dominio/rol.js';
import { PasetoService, TokenRechazadoError } from './servicios/paseto.service.js';
import { ContrasenasService } from './servicios/contrasenas.service.js';
import type { LoginDto, RegistroDto } from './dto/index.js';
import type { SesionCompleta } from './entrega-de-sesion.js';

/**
 * Servicio de aplicacion del modulo de autenticacion.
 *
 * Es la unica puerta del modulo: ningun otro importa la entidad Usuario ni su
 * repositorio, y el lint lo impide.
 */
@Injectable()
export class AutenticacionService {
  private readonly logger = new Logger('Autenticacion');

  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    private readonly paseto: PasetoService,
    private readonly contrasenas: ContrasenasService,
  ) {}

  async registrar(datos: RegistroDto): Promise<SesionCompleta> {
    const correoHash = this.contrasenas.hashDeCorreo(datos.correo);

    if (await this.usuarios.exists({ where: { correoHash } })) {
      // Se responde con un conflicto explicito porque el registro es publico y
      // el propio formulario necesita decirle a la persona que ya tiene cuenta.
      // En el login NO se hace esta distincion: ahi si seria enumeracion.
      throw new ConflictException('Ya existe una cuenta con ese correo.');
    }

    const usuario = this.usuarios.create({
      correo: datos.correo,
      correoHash,
      contrasenaHash: await this.contrasenas.cifrar(datos.contrasena),
      nombreCompleto: datos.nombreCompleto,
      // El registro publico solo crea candidatos. El DTO no admite `rol`.
      rol: Rol.Candidato,
      activo: true,
    });

    try {
      await this.usuarios.save(usuario);
    } catch (e) {
      // Dos registros simultaneos con el mismo correo pasan el `exists` a la vez
      // y solo uno sobrevive a la restriccion unica. La integridad la garantiza
      // la base de datos, no el `if` de arriba (seccion 13 del encuadre).
      if (esViolacionDeUnicidad(e)) {
        throw new ConflictException('Ya existe una cuenta con ese correo.');
      }
      throw e;
    }

    this.registrarEvento('usuario_registrado', { idUsuario: usuario.id, rol: usuario.rol });
    return this.construirSesion(usuario);
  }

  async iniciarSesion(datos: LoginDto): Promise<SesionCompleta> {
    const correoHash = this.contrasenas.hashDeCorreo(datos.correo);
    const usuario = await this.usuarios.findOne({ where: { correoHash } });

    // Se comprueba la contrasena aunque el usuario no exista, contra un hash de
    // relleno, para que el tiempo de respuesta no delate si el correo esta
    // registrado. Sin esto, medir la latencia permite enumerar cuentas.
    const hashAComprobar = usuario?.contrasenaHash ?? HASH_DE_RELLENO;
    const coincide = await this.contrasenas.coincide(datos.contrasena, hashAComprobar);

    if (!usuario || !coincide || !usuario.activo) {
      this.registrarEvento('auth_failure', {
        motivo: !usuario
          ? 'correo_no_registrado'
          : !coincide
            ? 'contrasena_incorrecta'
            : 'cuenta_inactiva',
      });
      // Un unico mensaje para los tres casos: decir cual fallo confirmaria si el
      // correo existe.
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    this.registrarEvento('auth_success', { idUsuario: usuario.id, rol: usuario.rol });
    return this.construirSesion(usuario);
  }

  async renovar(tokenDeRenovacion: string): Promise<SesionCompleta> {
    let contenido;
    try {
      contenido = await this.paseto.verificar(tokenDeRenovacion, 'renovacion');
    } catch (e) {
      if (e instanceof TokenRechazadoError) {
        throw new UnauthorizedException('Token de renovacion invalido o vencido.');
      }
      throw e;
    }

    const usuario = await this.usuarios.findOne({ where: { id: contenido.sub } });
    if (!usuario?.activo) {
      throw new UnauthorizedException('Token de renovacion invalido o vencido.');
    }
    if (fueEmitidoAntesDeLaInvalidacion(contenido.iat, usuario.tokensValidosDesde)) {
      // Cerro sesion en todos los dispositivos o cambio la contrasena.
      throw new UnauthorizedException('Token de renovacion invalido o vencido.');
    }

    return this.construirSesion(usuario);
  }

  /**
   * Resuelve el usuario de un token de acceso ya verificado.
   *
   * Lo usa el guardia de autenticacion. Se consulta la base de datos en cada
   * peticion a proposito: un token sigue siendo criptograficamente valido
   * despues de desactivar la cuenta, y sin esta comprobacion seguiria abriendo
   * puertas hasta que expirara.
   */
  async usuarioDeToken(idUsuario: string, emitidoEn: string): Promise<Usuario> {
    const usuario = await this.usuarios.findOne({ where: { id: idUsuario } });
    if (
      !usuario?.activo ||
      fueEmitidoAntesDeLaInvalidacion(emitidoEn, usuario.tokensValidosDesde)
    ) {
      throw new UnauthorizedException('Sesion no valida.');
    }
    return usuario;
  }

  /** Invalida todos los tokens del usuario emitidos hasta ahora. */
  async cerrarTodasLasSesiones(idUsuario: string): Promise<void> {
    await this.usuarios.update({ id: idUsuario }, { tokensValidosDesde: new Date() });
    this.registrarEvento('sesiones_cerradas', { idUsuario });
  }

  private async construirSesion(usuario: Usuario): Promise<SesionCompleta> {
    const [tokenDeAcceso, tokenDeRenovacion] = await Promise.all([
      this.paseto.emitirAcceso(usuario.id, usuario.rol),
      this.paseto.emitirRenovacion(usuario.id, usuario.rol),
    ]);

    const { exp } = await this.paseto.verificar(tokenDeAcceso, 'acceso');

    return {
      tokenDeAcceso,
      tokenDeRenovacion,
      expiraEn: exp,
      rol: usuario.rol,
      idUsuario: usuario.id,
    };
  }

  /** Registro estructurado de eventos de seguridad (Plan §9.1). */
  private registrarEvento(eventType: string, metadata: Record<string, unknown>): void {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType,
        metadata,
      }),
    );
  }
}

/**
 * Hash argon2id de una cadena que nadie usa. Sirve para gastar el mismo tiempo
 * comprobando una contrasena cuando el correo no existe.
 */
const HASH_DE_RELLENO =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsLWRlLXJlbGxlbm8kJA$Ik0kZTlXQnhUS0pYbWJmSGxpYnZFdw';

function esViolacionDeUnicidad(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

function fueEmitidoAntesDeLaInvalidacion(iso: string, corte: Date | null): boolean {
  if (!corte) return false;
  return new Date(iso).getTime() < corte.getTime();
}
