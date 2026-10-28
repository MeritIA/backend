import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { Vacante } from './entities/vacante.entity.js';
import { VacanteEjercicio } from './entities/vacante-ejercicio.entity.js';
import { VacanteCandidato } from './entities/vacante-candidato.entity.js';
import {
  EstadoVacante,
  admiteCambioDeEjercicios,
  admiteEdicion,
  puedeTransicionar,
} from './dominio/estado-vacante.js';
import { VACANTE_CERRADA, type EventoVacanteCerrada } from './dominio/eventos.js';
import { Rol } from '../autenticacion/index.js';
import { BusDeEventos } from '../../common/events/index.js';
import { EjerciciosService, type ResumenVersion } from '../ejercicios/index.js';
import type { CrearVacanteDto, EditarVacanteDto } from './dto/index.js';

/** Quien pide, tal como lo resolvio el guardia de autenticacion. */
export interface Solicitante {
  readonly id: string;
  readonly rol: Rol;
  /** Empresa a la que pertenece; null en un candidato o un admin de plataforma. */
  readonly idEmpresa: string | null;
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
    private readonly bus: BusDeEventos,
  ) {}

  async crear(datos: CrearVacanteDto, solicitante: Solicitante): Promise<Vacante> {
    const idEmpresa = this.empresaDe(solicitante);
    const vacante = this.vacantes.create({
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      ubicacion: datos.ubicacion ?? null,
      intentosPermitidos: datos.intentosPermitidos ?? 1,
      // El reclutador es quien la crea; no se acepta del cuerpo de la peticion.
      idReclutador: solicitante.id,
      // Y la empresa sale de el, tampoco del cuerpo: es la frontera de los datos.
      idEmpresa,
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

    if (solicitante.idEmpresa !== null) {
      // Las de su empresa: dos reclutadores de la misma empresa llevan el
      // mismo proceso. Las de otra empresa no existen para el.
      return this.vacantes.find({
        where: { idEmpresa: solicitante.idEmpresa },
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

    // Despues de guardar, nunca antes: un suscriptor que avisara de un cierre
    // que luego no se guarda escribiria a los candidatos por un cierre que no
    // existio. La entrega del bus es asincrona, asi que esto no hace esperar al
    // reclutador.
    this.bus.publicar<EventoVacanteCerrada>({
      name: VACANTE_CERRADA,
      occurredAt: new Date(),
      payload: {
        idVacante: id,
        idEmpresa: vacante.idEmpresa,
        idUsuarioQueCerro: solicitante.id,
      },
    });

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
    // Con la empresa: un ejercicio de otra empresa no se puede asociar, y ni
    // siquiera se confirma que exista.
    const existentes = await this.ejerciciosDelBanco.cualesExistenActivos(
      unicos,
      vacante.idEmpresa,
    );
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

  /**
   * Registra que a un candidato se le contrato (pantalla A08).
   *
   * POR QUE NO EXIGE HABER REVELADO LA IDENTIDAD ANTES
   *
   * Se penso: "no se puede contratar un alias". Se descarto por dos razones. La
   * primera es de arquitectura: el registro de revelaciones vive en reportes, y
   * reportes depende de vacantes, asi que preguntarselo crearia un ciclo entre
   * modulos. La segunda es que la regla no protegeria nada: quien no revelo la
   * identidad simplemente no sabe a quien contrato, y el sistema no tiene por
   * que impedirle registrar una decision que ya tomo fuera.
   *
   * SI EXIGE QUE LA VACANTE HAYA SALIDO DEL BORRADOR
   *
   * Contratar desde un borrador significaria que nadie fue evaluado, porque en
   * borrador no se recibe ninguna entrega.
   *
   * SE PUEDE CONTRATAR CON LA VACANTE YA CERRADA, y es el caso normal: en A08
   * se cierra el proceso y la contratacion se confirma despues. No contradice
   * "una vacante cerrada no se edita": esto no cambia la oferta, registra en
   * que termino.
   *
   * Es idempotente: volver a marcarlo no mueve la fecha ni el autor, porque la
   * primera es la que una auditoria lee.
   */
  async contratar(
    idVacante: string,
    idCandidato: string,
    solicitante: Solicitante,
  ): Promise<Vacante> {
    const vacante = await this.obtenerCompleta(idVacante);
    this.exigirPropiedad(vacante, solicitante);

    if (vacante.estado === EstadoVacante.Borrador) {
      throw new BadRequestException(
        'No se contrata en un borrador: en borrador no se recibe ninguna entrega.',
      );
    }

    const invitacion = await this.asignaciones.findOne({ where: { idVacante, idCandidato } });
    if (!invitacion) {
      // 404 y el mismo mensaje que una vacante inexistente: quien pregunta no
      // averigua si ese identificador es de alguien que participo.
      this.registrar('acceso_denegado_por_recurso', solicitante, { idVacante, idCandidato });
      throw new NotFoundException('Ese candidato no esta invitado a esta vacante.');
    }

    if (invitacion.contratadoEn === null) {
      invitacion.contratadoEn = new Date();
      invitacion.idUsuarioQueContrato = solicitante.id;
      await this.asignaciones.save(invitacion);
      this.registrar('candidato_contratado', solicitante, { idVacante, idCandidato });
    }

    return this.obtenerCompleta(idVacante);
  }

  // --- Consultas que otros modulos pueden necesitar, por esta puerta ---

  /**
   * Las cifras de la empresa que pide el panel de la pantalla A02.
   *
   * Devuelve tambien los identificadores de las vacantes porque el panel
   * necesita que OTROS modulos cuenten lo suyo —entregas en evaluacion, por
   * ejemplo— y ninguno de ellos puede consultar las tablas de este. Pasarles la
   * lista es la unica via que respeta la frontera; sin ella, el panel saldria de
   * una llamada por vacante, que es justo lo que A02 no puede permitirse.
   *
   * No lleva comprobacion de acceso porque no recibe nada de la peticion: la
   * empresa la pone quien llama a partir del token, nunca un parametro. No hay
   * identificador que cambiar.
   */
  async panelDeEmpresa(idEmpresa: string): Promise<PanelDeVacantes> {
    // Id y estado de cada vacante en una sola consulta: con decenas de
    // vacantes por empresa es mas barato que agrupar y volver a pedir los ids.
    const filas = await this.vacantes.find({
      where: { idEmpresa },
      select: { id: true, estado: true },
    });

    const porEstado = Object.fromEntries(
      Object.values(EstadoVacante).map((estado) => [estado, 0]),
    ) as Record<EstadoVacante, number>;
    for (const fila of filas) porEstado[fila.estado] += 1;

    const ids = filas.map((f) => f.id);
    const contratados =
      ids.length === 0
        ? 0
        : await this.asignaciones.count({
            where: { idVacante: In(ids), contratadoEn: Not(IsNull()) },
          });

    return { ids, porEstado, contratados };
  }

  /**
   * Lo que el modulo de notificaciones necesita para redactar el aviso de
   * cierre: el titulo, la empresa y el estado.
   *
   * El titulo va porque un correo que dice "se cerro un proceso" sin decir cual
   * no sirve de nada a quien se postulo a tres. El estado va para que el
   * suscriptor pueda comprobar por su cuenta que la vacante sigue cerrada: el
   * evento pudo publicarse hace rato, y un reenvio manual no debe avisar de un
   * cierre que ya no es cierto.
   *
   * No lleva comprobacion de acceso y por eso devuelve lo minimo: ni candidatos
   * ni ejercicios. Quien la llama lo hace por un evento de este mismo modulo o
   * desde un endpoint que ya comprobo la propiedad de la vacante.
   */
  async datosParaNotificar(idVacante: string): Promise<DatosParaNotificar | null> {
    const vacante = await this.vacantes.findOne({
      where: { id: idVacante },
      select: { id: true, titulo: true, idEmpresa: true, estado: true },
    });
    if (!vacante) return null;
    return {
      idVacante: vacante.id,
      titulo: vacante.titulo,
      idEmpresa: vacante.idEmpresa,
      estado: vacante.estado,
    };
  }

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
    if (solicitante.idEmpresa === null && solicitante.rol === Rol.Administrador) return true;
    return solicitante.rol !== Rol.Candidato && vacante.idEmpresa === solicitante.idEmpresa;
  }

  /**
   * Empresa dueña de una vacante, o null si ya no existe.
   *
   * La usa evaluacion para guardar cada resultado con su empresa: es lo que
   * permite que un reporte no mezcle datos de dos clientes.
   */
  async empresaDeLaVacante(idVacante: string): Promise<string | null> {
    const vacante = await this.vacantes.findOne({
      where: { id: idVacante },
      select: { id: true, idEmpresa: true },
    });
    return vacante?.idEmpresa ?? null;
  }

  async intentosPermitidosPara(idVacante: string): Promise<number> {
    const vacante = await this.vacantes.findOne({ where: { id: idVacante } });
    if (!vacante) throw new NotFoundException('La vacante no existe.');
    return vacante.intentosPermitidos;
  }

  /**
   * El enunciado y la rubrica de los ejercicios de la vacante.
   *
   * POR QUE ESTO EXISTE
   *
   * `GET /vacantes/:id` devuelve las filas de enlace (`idEjercicio`, `orden`),
   * no el enunciado. Y `ejercicios:leer` esta concedido a reclutador y
   * administrador, **no a candidato**. El resultado era que se invitaba a una
   * persona a resolver un ejercicio que no tenia forma de leer: podia entregar
   * un archivo, pero no saber que se le pedia ni como se le iba a calificar.
   *
   * POR QUE AQUI Y NO EN EL MODULO DE EJERCICIOS
   *
   * El permiso para leer esto no nace del banco de ejercicios, nace de la
   * vacante: se concede por estar invitado a ELLA. Por eso la puerta es esta, y
   * reusa `exigirAcceso`, que ya decide quien entra —el dueno, un administrador,
   * o un candidato invitado a una vacante que no sea borrador— y responde 404 a
   * los demas. Un candidato sigue sin poder leer el banco de la empresa.
   *
   * SE DEVUELVE LA VERSION VIGENTE, LA MISMA CON LA QUE SE CALIFICA
   *
   * `versionVigenteDe` es exactamente lo que el modulo de evaluacion consulta
   * para fijar contra que rubrica califica. Que las dos lean lo mismo es lo que
   * sostiene la promesa del producto: la rubrica es publica y es la misma para
   * todos los finalistas. Si un dia se versiona un ejercicio con una vacante ya
   * publicada, las dos cambian a la vez, no una sin la otra.
   */
  async ejerciciosDeLaVacante(id: string, solicitante: Solicitante): Promise<ResumenVersion[]> {
    const vacante = await this.obtenerCompleta(id);
    await this.exigirAcceso(vacante, solicitante);

    const versiones = await Promise.all(
      vacante.ejercicios.map((enlace) =>
        this.ejerciciosDelBanco.versionVigenteDe(enlace.idEjercicio),
      ),
    );

    // Un ejercicio sin ninguna version no deberia existir —se crea con la v1 en
    // la misma operacion—, pero si lo hubiera se omite en vez de romper la
    // pantalla entera del candidato por un dato corrupto de otro modulo.
    return versiones.filter((v): v is ResumenVersion => v !== null);
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

  private exigirPropiedad(vacante: Vacante, solicitante: Solicitante): void {
    if (solicitante.idEmpresa === null && solicitante.rol === Rol.Administrador) return;
    if (vacante.idEmpresa === solicitante.idEmpresa) return;

    this.registrar('acceso_denegado_por_recurso', solicitante, { idVacante: vacante.id });
    // Se responde 404 y no 403: un 403 confirmaria que la vacante existe, y con
    // eso se puede sondear el catalogo ajeno probando identificadores.
    throw new NotFoundException('La vacante no existe.');
  }

  /** Lectura: el dueno, un administrador, o un candidato invitado. */
  private async exigirAcceso(vacante: Vacante, solicitante: Solicitante): Promise<void> {
    if (solicitante.idEmpresa === null && solicitante.rol === Rol.Administrador) return;
    if (solicitante.rol !== Rol.Candidato && vacante.idEmpresa === solicitante.idEmpresa) {
      return;
    }

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

/** Las cifras de vacantes que el panel de la empresa (A02) necesita. */
export interface PanelDeVacantes {
  /** Identificadores de las vacantes de la empresa, para que otros cuenten. */
  ids: string[];
  porEstado: Record<EstadoVacante, number>;
  /** Personas contratadas en toda la empresa, no en una vacante. */
  contratados: number;
}

/** Lo justo para redactar el aviso de cierre de una vacante. */
export interface DatosParaNotificar {
  readonly idVacante: string;
  readonly titulo: string;
  readonly idEmpresa: string;
  readonly estado: EstadoVacante;
}
