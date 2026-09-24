import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Vacante } from './entities/vacante.entity.js';
import { VacanteEjercicio } from './entities/vacante-ejercicio.entity.js';
import { VacanteCandidato } from './entities/vacante-candidato.entity.js';
import {
  EstadoVacante,
  admiteCambioDeEjercicios,
  admiteEdicion,
  puedeTransicionar,
} from './dominio/estado-vacante.js';
import { Rol } from '../autenticacion/index.js';
import { EjerciciosService } from '../ejercicios/index.js';
import type { CrearVacanteDto, EditarVacanteDto } from './dto/index.js';

/** Quien pide, tal como lo resolvio el guardia de autenticacion. */
export interface Solicitante {
  readonly id: string;
  readonly rol: Rol;
}

/**
 * Servicio de aplicacion del modulo de vacantes.
 *
 * Es la unica puerta del modulo. No importa entidades de otros modulos: del de
 * autenticacion solo usa el enum de roles, que forma parte de su interfaz
 * publica.
 *
 * SOBRE LA AUTORIZACION
 *
 * El guardia de roles resuelve QUE rol puede llamar a cada endpoint. Lo que se
 * resuelve aqui es la otra mitad, la que ninguna tabla puede decidir: si ESTE
 * usuario puede tocar ESTE recurso. Es la regla que el encuadre pone como
 * criterio: cambiar un identificador en la peticion nunca debe dar acceso.
 */
@Injectable()
export class VacantesService {
  private readonly logger = new Logger('Vacantes');

  constructor(
    @InjectRepository(Vacante) private readonly vacantes: Repository<Vacante>,
    @InjectRepository(VacanteEjercicio)
    private readonly asociaciones: Repository<VacanteEjercicio>,
    @InjectRepository(VacanteCandidato)
    private readonly asignaciones: Repository<VacanteCandidato>,
    private readonly dataSource: DataSource,
    private readonly ejerciciosDelBanco: EjerciciosService,
  ) {}

  async crear(datos: CrearVacanteDto, solicitante: Solicitante): Promise<Vacante> {
    const vacante = this.vacantes.create({
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      ubicacion: datos.ubicacion ?? null,
      intentosPermitidos: datos.intentosPermitidos ?? 1,
      // El reclutador es quien la crea; no se acepta del cuerpo de la peticion.
      idReclutador: solicitante.id,
      estado: EstadoVacante.Borrador,
    });

    await this.vacantes.save(vacante);
    this.registrar('vacante_creada', solicitante, { idVacante: vacante.id });
    return this.obtenerCompleta(vacante.id);
  }

  /**
   * Listado, distinto segun quien pregunta.
   *
   * Tercer criterio de aceptacion: un candidato solo ve las vacantes que le han
   * sido asignadas. Y ademas solo las publicadas: una vacante en borrador
   * todavia no esta lista para que nadie la vea.
   */
  async listar(solicitante: Solicitante): Promise<Vacante[]> {
    if (solicitante.rol === Rol.Candidato) {
      const asignadas = await this.asignaciones.find({
        where: { idCandidato: solicitante.id },
        select: { idVacante: true },
      });
      const ids = asignadas.map((a) => a.idVacante);
      if (ids.length === 0) return [];

      return this.vacantes.find({
        where: { id: In(ids), estado: EstadoVacante.Publicada },
        relations: { ejercicios: true },
        order: { publicadaEn: 'DESC' },
      });
    }

    if (solicitante.rol === Rol.Reclutador) {
      // Un reclutador ve las suyas, no las de sus colegas.
      return this.vacantes.find({
        where: { idReclutador: solicitante.id },
        relations: { ejercicios: true, candidatos: true },
        order: { creadaEn: 'DESC' },
      });
    }

    return this.vacantes.find({
      relations: { ejercicios: true, candidatos: true },
      order: { creadaEn: 'DESC' },
    });
  }

  async obtenerPara(id: string, solicitante: Solicitante): Promise<Vacante> {
    const vacante = await this.obtenerCompleta(id);
    await this.exigirAcceso(vacante, solicitante);
    return vacante;
  }

  async editar(id: string, datos: EditarVacanteDto, solicitante: Solicitante): Promise<Vacante> {
    const vacante = await this.obtenerCompleta(id);
    this.exigirPropiedad(vacante, solicitante);

    if (!admiteEdicion(vacante.estado)) {
      throw new BadRequestException(
        'Una vacante cerrada no se edita: cambiarla alteraria el contexto de evaluaciones ya emitidas.',
      );
    }

    if (datos.titulo !== undefined) vacante.titulo = datos.titulo;
    if (datos.descripcion !== undefined) vacante.descripcion = datos.descripcion;
    if (datos.ubicacion !== undefined) vacante.ubicacion = datos.ubicacion;
    if (datos.intentosPermitidos !== undefined) {
      // Mismo motivo que los ejercicios: con el proceso abierto, cambiar el
      // limite dejaria a unos candidatos con mas oportunidades que otros.
      if (vacante.estado !== EstadoVacante.Borrador) {
        throw new BadRequestException(
          'El numero de intentos solo se cambia mientras la vacante es un borrador.',
        );
      }
      vacante.intentosPermitidos = datos.intentosPermitidos;
    }

    await this.vacantes.save(vacante);
    this.registrar('vacante_editada', solicitante, { idVacante: id });
    return this.obtenerCompleta(id);
  }

  /**
   * Publica la vacante.
   *
   * Segundo criterio de aceptacion: **no se publica sin al menos un ejercicio
   * asociado**. Una vacante publicada sin ejercicios dejaria a los candidatos
   * invitados sin nada que resolver.
   */
  async publicar(id: string, solicitante: Solicitante): Promise<Vacante> {
    await this.dataSource.transaction(async (manager) => {
      // Se bloquea la fila mientras dura la operacion: sin esto, dos peticiones
      // simultaneas podrian publicar dos veces, o publicar justo mientras otra
      // quita el ultimo ejercicio.
      const vacante = await manager.findOne(Vacante, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!vacante) throw new NotFoundException('La vacante no existe.');
      this.exigirPropiedad(vacante, solicitante);

      if (!puedeTransicionar(vacante.estado, EstadoVacante.Publicada)) {
        throw new BadRequestException(
          `Una vacante en estado "${vacante.estado}" no se puede publicar.`,
        );
      }

      const cuantos = await manager.count(VacanteEjercicio, { where: { idVacante: id } });
      if (cuantos === 0) {
        throw new BadRequestException(
          'La vacante necesita al menos un ejercicio asociado para publicarse.',
        );
      }

      vacante.estado = EstadoVacante.Publicada;
      vacante.publicadaEn = new Date();
      await manager.save(vacante);

      this.registrar('vacante_publicada', solicitante, { idVacante: id, ejercicios: cuantos });
    });

    // La relectura va FUERA de la transaccion, a proposito. Hacerla dentro
    // usaria el repositorio normal, ajeno a esa transaccion, y devolveria el
    // estado anterior al commit: la vacante quedaba publicada en la base pero
    // la respuesta HTTP decia "borrador". Lo detecto una prueba de integracion
    // que comprueba el cuerpo y no solo el codigo de estado.
    return this.obtenerCompleta(id);
  }

  async cerrar(id: string, solicitante: Solicitante): Promise<Vacante> {
    const vacante = await this.obtenerCompleta(id);
    this.exigirPropiedad(vacante, solicitante);

    if (!puedeTransicionar(vacante.estado, EstadoVacante.Cerrada)) {
      throw new BadRequestException('La vacante ya esta cerrada.');
    }

    vacante.estado = EstadoVacante.Cerrada;
    vacante.cerradaEn = new Date();
    await this.vacantes.save(vacante);

    this.registrar('vacante_cerrada', solicitante, { idVacante: id });
    return this.obtenerCompleta(id);
  }

  /** Reemplaza la lista de ejercicios de la vacante. Solo en borrador. */
  async asociarEjercicios(
    id: string,
    idsDeEjercicios: string[],
    solicitante: Solicitante,
  ): Promise<Vacante> {
    const vacante = await this.obtenerCompleta(id);
    this.exigirPropiedad(vacante, solicitante);

    if (!admiteCambioDeEjercicios(vacante.estado)) {
      throw new BadRequestException(
        'Los ejercicios solo se cambian mientras la vacante es un borrador: alterarlos despues dejaria a dos candidatos del mismo proceso resolviendo pruebas distintas.',
      );
    }

    const unicos = [...new Set(idsDeEjercicios)];
    if (unicos.length !== idsDeEjercicios.length) {
      throw new BadRequestException('La lista de ejercicios tiene identificadores repetidos.');
    }

    // Se pregunta al modulo de ejercicios por su interfaz publica, no a sus
    // tablas. Hasta que ese modulo existio, esta comprobacion no se podia hacer
    // y la vacante aceptaba identificadores inventados.
    const existentes = await this.ejerciciosDelBanco.cualesExistenActivos(unicos);
    const faltantes = unicos.filter((id) => !existentes.includes(id));
    if (faltantes.length > 0) {
      throw new BadRequestException(
        `Estos ejercicios no existen en el banco o fueron retirados: ${faltantes.join(', ')}`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(VacanteEjercicio, { idVacante: id });
      await manager.save(
        unicos.map((idEjercicio, orden) =>
          manager.create(VacanteEjercicio, { idVacante: id, idEjercicio, orden }),
        ),
      );
    });

    this.registrar('ejercicios_asociados', solicitante, { idVacante: id, cuantos: unicos.length });
    return this.obtenerCompleta(id);
  }

  /** Invita a un candidato. Es lo que le permitira ver la vacante. */
  async asignarCandidato(
    id: string,
    idCandidato: string,
    solicitante: Solicitante,
  ): Promise<Vacante> {
    const vacante = await this.obtenerCompleta(id);
    this.exigirPropiedad(vacante, solicitante);

    if (vacante.estado === EstadoVacante.Cerrada) {
      throw new BadRequestException('No se asignan candidatos a una vacante cerrada.');
    }

    const yaEsta = await this.asignaciones.exists({ where: { idVacante: id, idCandidato } });
    if (!yaEsta) {
      await this.asignaciones.save(this.asignaciones.create({ idVacante: id, idCandidato }));
      this.registrar('candidato_asignado', solicitante, { idVacante: id, idCandidato });
    }

    return this.obtenerCompleta(id);
  }

  // --- Consultas que otros modulos pueden necesitar, por esta puerta ---

  /**
   * Ejercicios de una vacante, en orden.
   *
   * La usara el modulo de entregas para saber que debe resolver un candidato,
   * sin tocar las tablas de este modulo.
   */
  async idsDeEjerciciosDe(idVacante: string): Promise<string[]> {
    const filas = await this.asociaciones.find({
      where: { idVacante },
      order: { orden: 'ASC' },
    });
    return filas.map((f) => f.idEjercicio);
  }

  /** Si un candidato esta invitado a una vacante publicada. */
  async candidatoTieneAcceso(idVacante: string, idCandidato: string): Promise<boolean> {
    const vacante = await this.vacantes.findOne({ where: { id: idVacante } });
    if (!vacante || vacante.estado === EstadoVacante.Borrador) return false;
    return this.asignaciones.exists({ where: { idVacante, idCandidato } });
  }

  /** Un candidato solo entrega en una vacante PUBLICADA a la que fue invitado. */
  async puedeRecibirEntrega(idVacante: string, idCandidato: string): Promise<boolean> {
    const vacante = await this.vacantes.findOne({ where: { id: idVacante } });
    if (vacante?.estado !== EstadoVacante.Publicada) return false;
    return this.asignaciones.exists({ where: { idVacante, idCandidato } });
  }

  /** Quien puede ver las entregas de una vacante: su reclutador o un administrador. */
  async puedeVerEntregasDe(idVacante: string, solicitante: Solicitante): Promise<boolean> {
    const vacante = await this.vacantes.findOne({ where: { id: idVacante } });
    if (!vacante) return false;
    if (solicitante.rol === Rol.Administrador) return true;
    return solicitante.rol === Rol.Reclutador && vacante.idReclutador === solicitante.id;
  }

  async intentosPermitidosPara(idVacante: string): Promise<number> {
    const vacante = await this.vacantes.findOne({ where: { id: idVacante } });
    if (!vacante) throw new NotFoundException('La vacante no existe.');
    return vacante.intentosPermitidos;
  }

  // --- Interno ---

  private async obtenerCompleta(id: string): Promise<Vacante> {
    const vacante = await this.vacantes.findOne({
      where: { id },
      relations: { ejercicios: true, candidatos: true },
      order: { ejercicios: { orden: 'ASC' } },
    });
    if (!vacante) throw new NotFoundException('La vacante no existe.');
    return vacante;
  }

  /** Solo el reclutador dueno, o un administrador, modifican una vacante. */
  private exigirPropiedad(vacante: Vacante, solicitante: Solicitante): void {
    if (solicitante.rol === Rol.Administrador) return;
    if (solicitante.rol === Rol.Reclutador && vacante.idReclutador === solicitante.id) return;

    this.registrar('acceso_denegado_por_recurso', solicitante, { idVacante: vacante.id });
    // Se responde 404 y no 403: un 403 confirmaria que la vacante existe, y con
    // eso se puede sondear el catalogo ajeno probando identificadores.
    throw new NotFoundException('La vacante no existe.');
  }

  /** Lectura: el dueno, un administrador, o un candidato invitado. */
  private async exigirAcceso(vacante: Vacante, solicitante: Solicitante): Promise<void> {
    if (solicitante.rol === Rol.Administrador) return;
    if (solicitante.rol === Rol.Reclutador && vacante.idReclutador === solicitante.id) return;

    if (solicitante.rol === Rol.Candidato) {
      const invitado = await this.asignaciones.exists({
        where: { idVacante: vacante.id, idCandidato: solicitante.id },
      });
      if (invitado && vacante.estado !== EstadoVacante.Borrador) return;
    }

    this.registrar('acceso_denegado_por_recurso', solicitante, { idVacante: vacante.id });
    // Mismo 404 que en exigirPropiedad, y por lo mismo: un 403 confirmaria que
    // la vacante existe, y con eso se sondea el catalogo ajeno probando
    // identificadores. El motivo real queda en el log.
    throw new NotFoundException('La vacante no existe.');
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
