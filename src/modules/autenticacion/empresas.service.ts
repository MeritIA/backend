import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Empresa } from './entities/empresa.entity.js';
import { Usuario } from './entities/usuario.entity.js';
import { ContrasenasService } from './servicios/contrasenas.service.js';
import type { UsuarioAutenticado } from './guardias/autenticacion.guard.js';
import type { CrearEmpresaDto, CrearUsuarioDeEmpresaDto } from './dto/index.js';

/**
 * Empresas clientes y sus usuarios.
 *
 * Vive dentro del modulo de autenticacion porque la empresa es parte de la
 * identidad: quien entra, y a que empresa pertenece. Ningun otro modulo importa
 * estas entidades.
 *
 * QUIEN PUEDE QUE
 *
 * - Administrador de plataforma (sin empresa): crea empresas y usuarios en
 *   cualquiera de ellas. Es el onboarding del paquete 5.3.
 * - Administrador de una empresa: solo crea usuarios de SU empresa.
 * - Nadie mas: el permiso ya lo restringe a administradores.
 */
@Injectable()
export class EmpresasService {
  private readonly logger = new Logger('Empresas');

  constructor(
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    private readonly contrasenas: ContrasenasService,
  ) {}

  async crear(datos: CrearEmpresaDto, solicitante: UsuarioAutenticado): Promise<Empresa> {
    // Un administrador de empresa no crea otras empresas: eso es de plataforma.
    if (solicitante.idEmpresa !== null) {
      throw new ForbiddenException('Solo un administrador de la plataforma crea empresas.');
    }

    const empresa = this.empresas.create({ nombre: datos.nombre, activa: true });
    try {
      await this.empresas.save(empresa);
    } catch (e) {
      // El indice unico va sobre lower(nombre): "Acme" y "ACME" chocan.
      if (esViolacionDeUnicidad(e)) {
        throw new ConflictException('Ya existe una empresa con ese nombre.');
      }
      throw e;
    }

    this.registrar('empresa_creada', solicitante, { idEmpresa: empresa.id });
    return empresa;
  }

  /** Un administrador de plataforma las ve todas; el de una empresa, la suya. */
  async listar(solicitante: UsuarioAutenticado): Promise<Empresa[]> {
    if (solicitante.idEmpresa === null) {
      return this.empresas.find({ order: { creadaEn: 'DESC' } });
    }
    return this.empresas.find({ where: { id: solicitante.idEmpresa } });
  }

  async crearUsuario(
    idEmpresa: string,
    datos: CrearUsuarioDeEmpresaDto,
    solicitante: UsuarioAutenticado,
  ): Promise<Usuario> {
    // 404 y no 403: a un administrador de otra empresa no se le confirma que
    // esta exista.
    if (solicitante.idEmpresa !== null && solicitante.idEmpresa !== idEmpresa) {
      this.registrar('acceso_denegado_por_recurso', solicitante, { idEmpresa });
      throw new NotFoundException('La empresa no existe.');
    }

    const empresa = await this.empresas.findOne({ where: { id: idEmpresa } });
    if (!empresa) throw new NotFoundException('La empresa no existe.');
    if (!empresa.activa) {
      throw new ConflictException('La empresa esta inactiva: no admite usuarios nuevos.');
    }

    const correoHash = this.contrasenas.hashDeCorreo(datos.correo);
    if (await this.usuarios.exists({ where: { correoHash } })) {
      throw new ConflictException('Ya existe una cuenta con ese correo.');
    }

    const usuario = this.usuarios.create({
      correo: datos.correo,
      correoHash,
      contrasenaHash: await this.contrasenas.cifrar(datos.contrasena),
      nombreCompleto: datos.nombreCompleto,
      rol: datos.rol,
      idEmpresa,
      activo: true,
    });

    try {
      await this.usuarios.save(usuario);
    } catch (e) {
      if (esViolacionDeUnicidad(e)) {
        throw new ConflictException('Ya existe una cuenta con ese correo.');
      }
      throw e;
    }

    this.registrar('usuario_de_empresa_creado', solicitante, {
      idUsuario: usuario.id,
      idEmpresa,
      rol: usuario.rol,
    });
    return usuario;
  }

  private registrar(eventType: string, solicitante: UsuarioAutenticado, metadata: object): void {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType,
        userId: solicitante.id,
        metadata: { ...metadata, rol: solicitante.rol },
      }),
    );
  }
}

function esViolacionDeUnicidad(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
