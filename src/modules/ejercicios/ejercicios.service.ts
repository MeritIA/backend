import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Ejercicio } from './entities/ejercicio.entity.js';
import { EjercicioVersion } from './entities/ejercicio-version.entity.js';
import { CriterioRubrica } from './entities/criterio-rubrica.entity.js';
import { Adjunto } from './entities/adjunto.entity.js';
import { AlmacenamientoService, ArchivoInvalidoError } from '../../common/almacenamiento/index.js';
import { RubricaInvalidaError, validarRubrica, type CriterioEntrada } from './dominio/rubrica.js';
import { Rol } from '../autenticacion/index.js';
import type { CrearEjercicioDto, NuevaVersionDto } from './dto/index.js';

export interface Solicitante {
  readonly id: string;
  readonly rol: Rol;
  /** Empresa a la que pertenece; null en un candidato o un admin de plataforma. */
  readonly idEmpresa: string | null;
}

/** Lo que otros modulos necesitan saber de una version, sin ver sus entidades. */
const MAXIMO_DE_ADJUNTOS = 5;

export interface ResumenDeAdjunto {
  readonly id: string;
  readonly nombre: string;
  readonly bytes: number;
}

export interface ResumenVersion {
  readonly idEjercicio: string;
  readonly idVersion: string;
  readonly numero: number;
  readonly titulo: string;
  readonly enunciado: string;
  /** Minutos de la sesion cronometrada; null si el ejercicio no tiene limite. */
  readonly duracionMinutos: number | null;
  /** Archivos que acompanan el enunciado (dataset, esqueleto). */
  readonly adjuntos: readonly ResumenDeAdjunto[];
  readonly criterios: readonly {
    readonly nombre: string;
    readonly descripcion: string;
    readonly peso: number;
    readonly escalaMaxima: number;
  }[];
}

/**
 * Banco de pruebas tecnicas.
 *
 * La regla que gobierna todo el modulo: **las versiones son inmutables**. No
 * hay operacion de edicion de enunciado ni de rubrica. Corregir significa crear
 * la version siguiente, y las anteriores se quedan tal cual para siempre.
 *
 * Es lo que hace posible el primer criterio de aceptacion del paquete —versionar
 * sin afectar entregas ya calificadas— y el tercero: una calificacion apunta a
 * una version concreta y esa version nunca cambia bajo sus pies.
 */
@Injectable()
export class EjerciciosService {
  private readonly logger = new Logger('Ejercicios');

  constructor(
    @InjectRepository(Ejercicio) private readonly ejercicios: Repository<Ejercicio>,
    @InjectRepository(EjercicioVersion) private readonly versiones: Repository<EjercicioVersion>,
    @InjectRepository(Adjunto) private readonly adjuntos: Repository<Adjunto>,
    private readonly dataSource: DataSource,
    private readonly almacen: AlmacenamientoService,
  ) {}

  async crear(datos: CrearEjercicioDto, solicitante: Solicitante): Promise<Ejercicio> {
    this.exigirRubricaValida(datos.criterios);
    const idEmpresa = this.empresaDe(solicitante);

    const id = await this.dataSource.transaction(async (manager) => {
      const ejercicio = await manager.save(
        manager.create(Ejercicio, {
          titulo: datos.titulo,
          tecnologia: datos.tecnologia ?? null,
          idAutor: solicitante.id,
          idEmpresa,
          activo: true,
        }),
      );

      await this.crearVersion(
        manager,
        ejercicio.id,
        1,
        datos.enunciado,
        datos.criterios,
        null,
        solicitante,
        datos.duracionMinutos ?? null,
      );
      return ejercicio.id;
    });

    this.registrar('ejercicio_creado', solicitante, { idEjercicio: id });
    return this.obtenerCompleto(id);
  }

  /**
   * Crea la version siguiente.
   *
   * Las anteriores no se tocan. El numero se calcula dentro de una transaccion
   * con bloqueo del ejercicio: sin eso, dos reclutadores versionando a la vez
   * calcularian el mismo numero y uno de los dos se perderia.
   */
  async nuevaVersion(
    idEjercicio: string,
    datos: NuevaVersionDto,
    solicitante: Solicitante,
  ): Promise<Ejercicio> {
    this.exigirRubricaValida(datos.criterios);

    await this.dataSource.transaction(async (manager) => {
      const ejercicio = await manager.findOne(Ejercicio, {
        where: { id: idEjercicio },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ejercicio) throw new NotFoundException('El ejercicio no existe.');
      this.exigirPropiedad(ejercicio, solicitante);

      const ultima = await manager.findOne(EjercicioVersion, {
        where: { idEjercicio },
        order: { numero: 'DESC' },
      });

      await this.crearVersion(
        manager,
        idEjercicio,
        (ultima?.numero ?? 0) + 1,
        datos.enunciado,
        datos.criterios,
        datos.motivoDelCambio ?? null,
        solicitante,
        datos.duracionMinutos ?? null,
      );
    });

    this.registrar('version_creada', solicitante, { idEjercicio });
    return this.obtenerCompleto(idEjercicio);
  }

  /**
   * Cuantos retos reutilizables tiene la empresa en su banco (cifra de A02).
   *
   * Cuenta solo los ACTIVOS: un ejercicio retirado se conserva para que las
   * evaluaciones ya emitidas sigan siendo auditables, pero no se puede asociar
   * a vacantes nuevas, y el panel pregunta con cuanto material cuenta hoy.
   *
   * Cuenta en la base en vez de cargar el banco entero con sus versiones y
   * criterios, que es lo que hace `listar` y seria absurdo para un numero.
   */
  async cuantosEnElBanco(idEmpresa: string): Promise<number> {
    return this.ejercicios.count({ where: { idEmpresa, activo: true } });
  }

  /**
   * Adjunta un archivo a la version VIGENTE del ejercicio (la ultima).
   *
   * Solo el dueno del ejercicio. Maximo cinco por version: es un dataset o un
   * esqueleto, no un repositorio. El archivo no se interpreta ni se envia a la IA.
   */
  async adjuntar(
    idEjercicio: string,
    archivo: { originalname: string; buffer: Buffer; mimetype: string } | undefined,
    solicitante: Solicitante,
  ): Promise<ResumenVersion> {
    if (!archivo) throw new BadRequestException('Falta el archivo (campo "archivo").');
    const ejercicio = await this.obtenerCompleto(idEjercicio);
    this.exigirPropiedad(ejercicio, solicitante);
    const version = await this.versiones.findOneOrFail({
      where: { idEjercicio },
      order: { numero: 'DESC' },
      relations: { adjuntos: true, criterios: true, ejercicio: true },
    });
    if (version.adjuntos.length >= MAXIMO_DE_ADJUNTOS) {
      throw new BadRequestException(
        `Una version admite hasta ${MAXIMO_DE_ADJUNTOS} archivos adjuntos.`,
      );
    }
    let referencia;
    try {
      referencia = await this.almacen.subirAdjunto(
        idEjercicio,
        archivo.originalname,
        archivo.buffer,
        archivo.mimetype || 'application/octet-stream',
      );
    } catch (e) {
      if (e instanceof ArchivoInvalidoError) throw new BadRequestException(e.message);
      throw e;
    }
    await this.adjuntos.save(
      this.adjuntos.create({
        idVersion: version.id,
        nombre: archivo.originalname.slice(0, 200),
        clave: referencia.clave,
        bytes: referencia.bytes,
        tipoContenido: referencia.tipoContenido,
        sha256: referencia.sha256,
      }),
    );
    this.registrar('adjunto_agregado', solicitante, { idEjercicio });
    return this.aResumen(
      await this.versiones.findOneOrFail({
        where: { id: version.id },
        relations: { criterios: true, ejercicio: true, adjuntos: true },
      }),
    );
  }

  /** Enlace firmado de un adjunto. Quien llama ya comprobo que puede leer el ejercicio. */
  async enlaceDeAdjunto(idEjercicio: string, idAdjunto: string): Promise<string> {
    const adjunto = await this.adjuntos
      .createQueryBuilder('a')
      .innerJoin('a.version', 'v')
      .where('a.id = :idAdjunto', { idAdjunto })
      .andWhere('v.id_ejercicio = :idEjercicio', { idEjercicio })
      .getOne();
    if (!adjunto) throw new NotFoundException('El archivo no existe.');
    return this.almacen.enlaceDeDescarga({
      clave: adjunto.clave,
      bytes: adjunto.bytes,
      sha256: adjunto.sha256,
      tipoContenido: adjunto.tipoContenido,
      nombreOriginal: adjunto.nombre,
    });
  }

  async listar(solicitante: Solicitante): Promise<Ejercicio[]> {
    // El banco es de la EMPRESA, no de quien escribio el ejercicio: dos
    // reclutadores de la misma empresa trabajan sobre el mismo banco. Un
    // administrador de plataforma (sin empresa) lo ve entero.
    const where = solicitante.idEmpresa === null ? {} : { idEmpresa: solicitante.idEmpresa };
    return this.ejercicios.find({
      where,
      relations: { versiones: { criterios: true } },
      order: { creadoEn: 'DESC' },
    });
  }

  async obtenerPara(id: string, solicitante: Solicitante): Promise<Ejercicio> {
    const ejercicio = await this.obtenerCompleto(id);
    this.exigirPropiedad(ejercicio, solicitante);
    return ejercicio;
  }

  /** Retira un ejercicio del banco sin borrarlo: lo ya calificado sigue auditable. */
  async retirar(id: string, solicitante: Solicitante): Promise<Ejercicio> {
    const ejercicio = await this.obtenerCompleto(id);
    this.exigirPropiedad(ejercicio, solicitante);

    ejercicio.activo = false;
    await this.ejercicios.save(ejercicio);
    this.registrar('ejercicio_retirado', solicitante, { idEjercicio: id });
    return this.obtenerCompleto(id);
  }

  // --- Puerta para otros modulos ---

  /**
   * Cuales de estos ejercicios existen y siguen activos.
   *
   * La usa el modulo de vacantes para validar lo que asocia, sin tocar estas
   * tablas ni importar estas entidades.
   */
  async cualesExistenActivos(ids: readonly string[], idEmpresa: string): Promise<string[]> {
    if (ids.length === 0) return [];
    const encontrados = await this.ejercicios.find({
      where: { id: In([...ids]), activo: true, idEmpresa },
      select: { id: true },
    });
    return encontrados.map((e) => e.id);
  }

  /**
   * Version vigente de un ejercicio: la de numero mas alto.
   *
   * La usara el modulo de evaluacion para fijar contra que rubrica califica y
   * guardar esa referencia con la nota, que es el tercer criterio del paquete.
   */
  async versionVigenteDe(idEjercicio: string): Promise<ResumenVersion | null> {
    const version = await this.versiones.findOne({
      where: { idEjercicio },
      relations: { criterios: true, ejercicio: true, adjuntos: true },
      order: { numero: 'DESC' },
    });
    return version ? this.aResumen(version) : null;
  }

  /** Una version concreta, para poder mostrar con que se califico en su momento. */
  async versionPorId(idVersion: string): Promise<ResumenVersion | null> {
    const version = await this.versiones.findOne({
      where: { id: idVersion },
      relations: { criterios: true, ejercicio: true, adjuntos: true },
    });
    return version ? this.aResumen(version) : null;
  }

  // --- Interno ---

  private async crearVersion(
    manager: DataSource['manager'],
    idEjercicio: string,
    numero: number,
    enunciado: string,
    criterios: readonly CriterioEntrada[],
    motivoDelCambio: string | null,
    solicitante: Solicitante,
    duracionMinutos: number | null = null,
  ): Promise<void> {
    const version = await manager.save(
      manager.create(EjercicioVersion, {
        idEjercicio,
        numero,
        enunciado,
        motivoDelCambio,
        duracionMinutos,
        idAutor: solicitante.id,
      }),
    );

    await manager.save(
      criterios.map((c, orden) =>
        manager.create(CriterioRubrica, {
          idVersion: version.id,
          nombre: c.nombre,
          descripcion: c.descripcion,
          peso: c.peso,
          escalaMaxima: c.escalaMaxima,
          orden,
        }),
      ),
    );
  }

  /** Traduce RubricaInvalidaError a un 400 con su explicacion. */
  private exigirRubricaValida(criterios: readonly CriterioEntrada[]): void {
    try {
      validarRubrica(criterios);
    } catch (e) {
      if (e instanceof RubricaInvalidaError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  private async obtenerCompleto(id: string): Promise<Ejercicio> {
    const ejercicio = await this.ejercicios.findOne({
      where: { id },
      relations: { versiones: { criterios: true, adjuntos: true } },
      order: { versiones: { numero: 'DESC', criterios: { orden: 'ASC' } } },
    });
    if (!ejercicio) throw new NotFoundException('El ejercicio no existe.');
    return ejercicio;
  }

  /**
   * La empresa de quien pide, exigida.
   *
   * Un administrador de plataforma no tiene empresa: puede leerlo todo, pero no
   * crear nada, porque no se sabria de quien seria lo creado.
   */
  private empresaDe(solicitante: Solicitante): string {
    if (solicitante.idEmpresa === null) {
      throw new BadRequestException(
        'Tu cuenta no pertenece a ninguna empresa, asi que no puede crear recursos de una.',
      );
    }
    return solicitante.idEmpresa;
  }

  private exigirPropiedad(ejercicio: Ejercicio, solicitante: Solicitante): void {
    if (solicitante.idEmpresa === null && solicitante.rol === Rol.Administrador) return;
    if (ejercicio.idEmpresa === solicitante.idEmpresa) return;

    this.registrar('acceso_denegado_por_recurso', solicitante, { idEjercicio: ejercicio.id });
    // 404 y no 403, igual que en vacantes: un 403 confirmaria que existe.
    throw new NotFoundException('El ejercicio no existe.');
  }

  private aResumen(version: EjercicioVersion): ResumenVersion {
    return {
      idEjercicio: version.idEjercicio,
      idVersion: version.id,
      numero: version.numero,
      titulo: version.ejercicio?.titulo ?? '',
      enunciado: version.enunciado,
      duracionMinutos: version.duracionMinutos,
      adjuntos: (version.adjuntos ?? []).map((a) => ({
        id: a.id,
        nombre: a.nombre,
        bytes: a.bytes,
      })),
      criterios: [...version.criterios]
        .sort((a, b) => a.orden - b.orden)
        .map((c) => ({
          nombre: c.nombre,
          descripcion: c.descripcion,
          peso: c.peso,
          escalaMaxima: c.escalaMaxima,
        })),
    };
  }

  private registrar(eventType: string, solicitante: Solicitante, metadata: object): void {
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
