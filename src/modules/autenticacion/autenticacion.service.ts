import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Usuario } from './entities/usuario.entity.js';
import { Rol } from './dominio/rol.js';
import { randomUUID } from 'node:crypto';
import { BusDeEventos } from '../../common/events/index.js';
import { CUENTA_ELIMINADA, type EventoCuentaEliminada } from './dominio/eventos.js';
import { PasetoService, TokenRechazadoError } from './servicios/paseto.service.js';
import { ContrasenasService } from './servicios/contrasenas.service.js';
import { EmpresasService } from './empresas.service.js';
import type { LoginDto, RegistrarEmpresaDto, RegistroDto } from './dto/index.js';
import type { SesionCompleta } from './entrega-de-sesion.js';

/** Lo que otro modulo puede saber de un usuario: como se llama y su correo. */
export interface Identidad {
  readonly nombre: string;
  readonly correo: string;
}

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
    private readonly bus: BusDeEventos,
    private readonly empresas: EmpresasService,
  ) {}

  /**
   * El identificador del CANDIDATO con ese correo, o null.
   *
   * Existe para que una empresa invite escribiendo un correo en vez de pegar un
   * UUID. Solo devuelve candidatos: un reclutador o un administrador no se
   * invitan a un reto, y distinguirlos de «no existe» filtraria quien trabaja
   * en que empresa. Quien llama debe responder igual en ambos casos.
   */
  async idDeCandidatoPorCorreo(correo: string): Promise<string | null> {
    const correoHash = this.contrasenas.hashDeCorreo(correo);
    const usuario = await this.usuarios.findOne({
      where: { correoHash, rol: Rol.Candidato },
      select: { id: true },
    });
    return usuario?.id ?? null;
  }

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
      // Un candidato no pertenece a ninguna empresa: es una persona invitada.
      idEmpresa: null,
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

  /** A01: crea la empresa con su primer administrador y abre su sesion. */
  async registrarEmpresa(datos: RegistrarEmpresaDto): Promise<SesionCompleta> {
    return this.construirSesion(await this.empresas.autorregistrar(datos));
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

  /**
   * Nombre y correo de un grupo de usuarios, para que otro modulo pueda
   * mostrar de quien habla.
   *
   * Lo necesita el reporte del paquete 5.1: su criterio es que "el reclutador
   * consulta el ranking de candidatos", y un ranking de identificadores no es
   * un ranking de candidatos.
   *
   * SOLO NOMBRE Y CORREO, y en lote. Devolver el Usuario entero repartiria por
   * el monolito el hash de la contrasena y el estado de la cuenta, que no le
   * hacen falta a nadie de fuera. En lote porque la alternativa es una consulta
   * por fila del ranking.
   *
   * Que el reclutador vea el correo no abre nada: es el correo con el que el
   * mismo invito al candidato a la vacante.
   */
  async identidadesDe(ids: readonly string[]): Promise<Map<string, Identidad>> {
    if (ids.length === 0) return new Map();
    // Sin duplicados: el ranking puede traer el mismo candidato en dos filas.
    const unicos = [...new Set(ids)];
    const usuarios = await this.usuarios.find({ where: { id: In(unicos) } });
    return new Map(usuarios.map((u) => [u.id, { nombre: u.nombreCompleto, correo: u.correo }]));
  }

  /** Invalida todos los tokens del usuario emitidos hasta ahora. */
  /** Lo que la cuenta guarda de la persona. Es la parte de «descargar mis datos» que vive aqui. */
  async perfilDe(idUsuario: string): Promise<{
    id: string;
    nombreCompleto: string;
    correo: string;
    rol: Rol;
    idEmpresa: string | null;
    creadoEn: Date;
  }> {
    const u = await this.usuarios.findOneOrFail({ where: { id: idUsuario } });
    return {
      id: u.id,
      nombreCompleto: u.nombreCompleto,
      correo: u.correo,
      rol: u.rol,
      idEmpresa: u.idEmpresa,
      creadoEn: u.creadoEn,
    };
  }

  /**
   * Alta de un moderador: personal de la plataforma, sin empresa. Solo la llama
   * el endpoint de gestion de moderacion, que ya exige ser administrador.
   */
  async crearModerador(datos: {
    correo: string;
    contrasena: string;
    nombreCompleto: string;
  }): Promise<{ id: string; correo: string; nombreCompleto: string }> {
    const correoHash = this.contrasenas.hashDeCorreo(datos.correo);
    if (await this.usuarios.exists({ where: { correoHash } })) {
      throw new ConflictException('Ya existe una cuenta con ese correo.');
    }
    const usuario = await this.usuarios.save(
      this.usuarios.create({
        correo: datos.correo,
        correoHash,
        contrasenaHash: await this.contrasenas.cifrar(datos.contrasena),
        nombreCompleto: datos.nombreCompleto,
        rol: Rol.Moderador,
        idEmpresa: null,
        activo: true,
      }),
    );
    this.registrarEvento('moderador_creado', { idUsuario: usuario.id });
    return { id: usuario.id, correo: datos.correo, nombreCompleto: datos.nombreCompleto };
  }

  /**
   * Elimina la cuenta: la ANONIMIZA y la cierra, y avisa para que los demas
   * modulos borren lo suyo.
   *
   * No se borra la fila: las entregas y evaluaciones ya hechas apuntan a ella, y
   * son parte del expediente de la empresa (el ranking, la auditoria). Lo que se
   * va es lo que identifica a la persona: nombre, correo, contrasena y la
   * posibilidad de entrar. Pide la contrasena: es una accion que no se deshace.
   */
  async eliminarCuenta(idUsuario: string, contrasena: string): Promise<void> {
    const usuario = await this.usuarios.findOneOrFail({ where: { id: idUsuario } });
    if (!(await this.contrasenas.coincide(contrasena, usuario.contrasenaHash))) {
      throw new UnauthorizedException('La contrasena no es correcta.');
    }
    const correoAnonimo = `eliminada-${usuario.id}@cuenta-eliminada.invalid`;
    await this.usuarios.update(
      { id: usuario.id },
      {
        correo: correoAnonimo,
        correoHash: this.contrasenas.hashDeCorreo(correoAnonimo),
        nombreCompleto: 'Cuenta eliminada',
        // Nadie conoce esta contrasena: la cuenta no vuelve a abrirse.
        contrasenaHash: await this.contrasenas.cifrar(randomUUID() + randomUUID()),
        activo: false,
        tokensValidosDesde: new Date(),
      },
    );
    this.registrarEvento('cuenta_eliminada', { idUsuario });
    this.bus.publicar<EventoCuentaEliminada>({
      name: CUENTA_ELIMINADA,
      occurredAt: new Date(),
      payload: { idUsuario },
    });
  }

  async cerrarTodasLasSesiones(idUsuario: string): Promise<void> {
    await this.usuarios.update({ id: idUsuario }, { tokensValidosDesde: new Date() });
    this.registrarEvento('sesiones_cerradas', { idUsuario });
  }

  private async construirSesion(usuario: Usuario): Promise<SesionCompleta> {
    const [tokenDeAcceso, tokenDeRenovacion] = await Promise.all([
      this.paseto.emitirAcceso(usuario.id, usuario.rol, usuario.idEmpresa),
      this.paseto.emitirRenovacion(usuario.id, usuario.rol, usuario.idEmpresa),
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
