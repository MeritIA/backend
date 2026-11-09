import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { Vacante } from './entities/vacante.entity.js';
import type { Modalidad } from './dominio/modalidad.js';
import { VacanteEjercicio } from './entities/vacante-ejercicio.entity.js';
import { VacanteCandidato } from './entities/vacante-candidato.entity.js';
import { Postulacion } from './entities/postulacion.entity.js';
import {
  EstadoVacante,
  admiteCambioDeEjercicios,
  admiteEdicion,
  puedeTransicionar,
} from './dominio/estado-vacante.js';
import { EstadoPostulacion, puedeDecidirse } from './dominio/estado-postulacion.js';
import {
  decidirInvitacionAutomatica,
  type PoliticaDeInvitacion,
} from './dominio/politica-de-invitacion.js';
import type { CalculadorDeAfinidad } from './dominio/calculador-de-afinidad.js';
import { VACANTE_CERRADA, type EventoVacanteCerrada } from './dominio/eventos.js';
import {
  AutenticacionService,
  CUENTA_ELIMINADA,
  EmpresasService,
  Rol,
  type EventoCuentaEliminada,
  type SectorEmpresa,
} from '../autenticacion/index.js';
import { BusDeEventos } from '../../common/events/index.js';
import { EjerciciosService, type ResumenVersion } from '../ejercicios/index.js';
import type { CrearVacanteDto, EditarVacanteDto } from './dto/index.js';

/**
 * El "solicitante" con el que se registran los actos de la maquina.
 *
 * Los registros de seguridad llevan siempre un usuario, y una invitacion
 * automatica no la pide nadie. Se usa el reclutador de la vacante --quien
 * encendio la politica y responde por ella-- con el rol anotado, para que una
 * auditoria distinga lo que hizo una persona de lo que hizo la politica.
 */
const SISTEMA = { rol: Rol.Reclutador, idEmpresa: null } as const;

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
export class VacantesService implements OnModuleInit {
  private readonly logger = new Logger('Vacantes');

  /**
   * Quien sabe calcular la afinidad, o `null` si nadie se registro.
   *
   * No es una dependencia del constructor porque vendria de `reportes`, y
   * `reportes` depende de este modulo: seria un ciclo. Lo registra
   * `ReportesService` al arrancar. Ver `dominio/calculador-de-afinidad.ts`.
   */
  private calculadorDeAfinidad: CalculadorDeAfinidad | null = null;

  constructor(
    @InjectRepository(Vacante) private readonly vacantes: Repository<Vacante>,
    @InjectRepository(VacanteEjercicio)
    private readonly asociaciones: Repository<VacanteEjercicio>,
    @InjectRepository(VacanteCandidato)
    private readonly asignaciones: Repository<VacanteCandidato>,
    @InjectRepository(Postulacion)
    private readonly postulaciones: Repository<Postulacion>,
    private readonly dataSource: DataSource,
    // El catalogo necesita el nombre de quien publica. Se pide a su dueño en
    // vez de importar la entidad Empresa: la empresa es parte de la identidad.
    private readonly empresas: EmpresasService,
    private readonly autenticacion: AutenticacionService,
    private readonly ejerciciosDelBanco: EjerciciosService,
    private readonly bus: BusDeEventos,
  ) {}

  onModuleInit(): void {
    // Una postulacion es una solicitud de la persona: sin persona no tiene sentido.
    // Las invitaciones y entregas SI se conservan: son parte del proceso de la empresa.
    this.bus.suscribir<EventoCuentaEliminada>(CUENTA_ELIMINADA, async (evento) => {
      await this.postulaciones.delete({ idCandidato: evento.payload.idUsuario });
    });
  }

  async crear(datos: CrearVacanteDto, solicitante: Solicitante): Promise<Vacante> {
    const idEmpresa = this.empresaDe(solicitante);
    const vacante = this.vacantes.create({
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      ubicacion: datos.ubicacion ?? null,
      modalidad: datos.modalidad ?? null,
      tecnologias: datos.tecnologias ?? [],
      intentosPermitidos: datos.intentosPermitidos ?? 1,
      // Los dos son planes del reclutador y pueden no existir: null significa
      // "no lo planifico", que es distinto de cero o de una fecha inventada.
      cierreEstimado: datos.cierreEstimado === undefined ? null : new Date(datos.cierreEstimado),
      finalistasAEvaluar: datos.finalistasAEvaluar ?? null,
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
   * sido asignadas. Y de esas, las publicadas y las cerradas: lo que se
   * esconde es el BORRADOR, que todavia no esta listo para que nadie lo vea.
   * Un proceso cerrado si se muestra, porque es donde el candidato va a mirar
   * su resultado cuando le llega el aviso.
   */
  async listar(solicitante: Solicitante): Promise<Vacante[]> {
    if (solicitante.rol === Rol.Candidato) {
      const asignadas = await this.asignaciones.find({
        where: { idCandidato: solicitante.id },
        select: { idVacante: true },
      });
      const ids = asignadas.map((a) => a.idVacante);
      if (ids.length === 0) return [];

      // Publicadas Y CERRADAS. El filtro existe para esconder los borradores
      // —una vacante sin publicar todavia no esta lista para que nadie la
      // vea—, no para esconder los procesos terminados: el aviso de cierre le
      // dice al candidato "tu resultado ya esta disponible en MeritIA" (D-10),
      // y dejar la vacante fuera de su lista le quita la unica forma de
      // llegar a el. Se encontro recorriendo el flujo con el front.
      return this.vacantes.find({
        where: {
          id: In(ids),
          estado: In([EstadoVacante.Publicada, EstadoVacante.Cerrada]),
        },
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

    if (datos.modalidad !== undefined) vacante.modalidad = datos.modalidad;
    if (datos.tecnologias !== undefined) vacante.tecnologias = datos.tecnologias;

    // Sin la comprobacion de estado que llevan los intentos, y a proposito: la
    // razon esta escrita al lado de la columna en la entidad.
    if (datos.cierreEstimado !== undefined) {
      vacante.cierreEstimado =
        datos.cierreEstimado === null ? null : new Date(datos.cierreEstimado);
    }
    if (datos.finalistasAEvaluar !== undefined) {
      vacante.finalistasAEvaluar = datos.finalistasAEvaluar;
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
  /** Invita por identificador o por correo; el correo se resuelve a un candidato real. */
  async invitar(
    id: string,
    datos: { idCandidato?: string; correo?: string },
    solicitante: Solicitante,
  ): Promise<Vacante> {
    if ((datos.idCandidato === undefined) === (datos.correo === undefined)) {
      throw new BadRequestException('Envia idCandidato o correo, uno de los dos.');
    }
    let idCandidato = datos.idCandidato;
    if (idCandidato === undefined) {
      // Se comprueba la propiedad ANTES de buscar: quien no es dueño de la
      // vacante no debe poder usar este endpoint para saber que correos existen.
      this.exigirPropiedad(await this.obtenerCompleta(id), solicitante);
      const encontrado = await this.autenticacion.idDeCandidatoPorCorreo(datos.correo!);
      if (!encontrado) {
        throw new NotFoundException('No hay ningun candidato registrado con ese correo.');
      }
      idCandidato = encontrado;
    }
    return this.asignarCandidato(id, idCandidato, solicitante);
  }

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
      select: {
        id: true,
        estado: true,
        titulo: true,
        cierreEstimado: true,
        finalistasAEvaluar: true,
        publicadaEn: true,
      },
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

    return { ids, porEstado, contratados, abiertas: await this.resumirAbiertas(filas) };
  }

  /**
   * Las vacantes publicadas con su plan y cuanta gente hay invitada.
   *
   * SOLO LAS PUBLICADAS. Un borrador no tiene a quien haya invitado, asi que su
   * avance seria 0 de 0 —un dato que no dice nada—, y una cerrada ya termino. La
   * pregunta que el panel responde con esta lista es "como van las abiertas",
   * que es la unica sobre la que el reclutador puede actuar hoy; cuantos
   * borradores y cuantas cerradas hay ya lo dicen los contadores.
   *
   * ORDENADAS POR CIERRE ESTIMADO, y las que no tienen estimado al final: lo
   * primero que una pantalla de panel tiene que mostrar es lo que se va a
   * vencer. Se ordena aqui y no en el frontend para que las dos pantallas que
   * usen esto no decidan cada una un orden distinto.
   */
  private async resumirAbiertas(filas: Vacante[]): Promise<VacanteAbierta[]> {
    const abiertas = filas.filter((f) => f.estado === EstadoVacante.Publicada);
    if (abiertas.length === 0) return [];

    const invitados = await this.asignaciones
      .createQueryBuilder('a')
      .select('a.id_vacante', 'idVacante')
      .addSelect('count(*)::int', 'total')
      .where('a.id_vacante IN (:...ids)', { ids: abiertas.map((a) => a.id) })
      .groupBy('a.id_vacante')
      .getRawMany<{ idVacante: string; total: number }>();

    const porVacante = new Map(invitados.map((i) => [i.idVacante, Number(i.total)]));

    return abiertas
      .map((v) => ({
        id: v.id,
        titulo: v.titulo,
        cierreEstimado: v.cierreEstimado,
        finalistasAEvaluar: v.finalistasAEvaluar,
        publicadaEn: v.publicadaEn,
        invitados: porVacante.get(v.id) ?? 0,
      }))
      .sort(compararPorCierre);
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

  /**
   * Las rubricas de varias vacantes PUBLICADAS, en lote.
   *
   * La usa el calculo de afinidad del catalogo abierto. No pasa por
   * `exigirAcceso` a proposito, y la razon no es comodidad: el candidato del
   * catalogo **no esta invitado**, asi que `exigirAcceso` le responderia 404 y
   * no habria afinidad que calcular para nadie.
   *
   * POR QUE ES SEGURO NO EXIGIR INVITACION AQUI
   *
   * Solo lee vacantes en estado **publicada**, que son las que ya salen en el
   * catalogo para todo el mundo. Y devuelve unicamente **nombre y peso** de
   * cada criterio: ni el enunciado, ni la descripcion del criterio, que es lo
   * que B14 ensena a quien ya esta dentro. Que los pesos sean publicos es la
   * promesa del producto --la rubrica es la misma para todos los finalistas--
   * no una fuga.
   */
  async rubricasDeVacantesPublicadas(
    ids: readonly string[],
  ): Promise<Map<string, { nombre: string; peso: number }[][]>> {
    if (ids.length === 0) return new Map();

    const vacantes = await this.vacantes.find({
      where: { id: In([...ids]), estado: EstadoVacante.Publicada },
      relations: { ejercicios: true },
    });

    // Una sola lectura por ejercicio aunque lo usen varias vacantes: en una
    // empresa que reutiliza su banco, eso es la diferencia entre 4 consultas y
    // 40.
    const idsDeEjercicios = [
      ...new Set(vacantes.flatMap((v) => v.ejercicios.map((e) => e.idEjercicio))),
    ];
    const versiones = new Map(
      await Promise.all(
        idsDeEjercicios.map(
          async (idEjercicio) =>
            [idEjercicio, await this.ejerciciosDelBanco.versionVigenteDe(idEjercicio)] as const,
        ),
      ),
    );

    return new Map(
      vacantes.map((vacante) => [
        vacante.id,
        vacante.ejercicios
          .map((enlace) => versiones.get(enlace.idEjercicio))
          .filter((v): v is ResumenVersion => v != null)
          .map((version) => version.criterios.map((c) => ({ nombre: c.nombre, peso: c.peso }))),
      ]),
    );
  }

  /**
   * Enlace firmado a un adjunto del enunciado de un ejercicio de esta vacante.
   * Mismo acceso que leer el enunciado: el candidato invitado a una vacante
   * publicada, o la empresa dueña. El ejercicio debe ser de la vacante: un
   * identificador cambiado en la ruta no da acceso a adjuntos de otra.
   */
  async enlaceDeAdjunto(
    id: string,
    idEjercicio: string,
    idAdjunto: string,
    solicitante: Solicitante,
  ): Promise<{ url: string; expiraEnSegundos: number }> {
    const vacante = await this.obtenerCompleta(id);
    await this.exigirAcceso(vacante, solicitante);
    if (!vacante.ejercicios.some((e) => e.idEjercicio === idEjercicio)) {
      throw new NotFoundException('El archivo no existe.');
    }
    const url = await this.ejerciciosDelBanco.enlaceDeAdjunto(idEjercicio, idAdjunto);
    return { url, expiraEnSegundos: 300 };
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

  /** En cuantas vacantes (no borrador) de la empresa se usa cada ejercicio. */
  async usoDeEjercicios(idEmpresa: string): Promise<Record<string, number>> {
    const filas = await this.asociaciones
      .createQueryBuilder('a')
      .innerJoin('a.vacante', 'v')
      .select('a.id_ejercicio', 'idEjercicio')
      .addSelect('count(distinct a.id_vacante)::int', 'vacantes')
      .where('v.id_empresa = :idEmpresa', { idEmpresa })
      .andWhere('v.estado <> :borrador', { borrador: EstadoVacante.Borrador })
      .groupBy('a.id_ejercicio')
      .getRawMany<{ idEjercicio: string; vacantes: number }>();
    return Object.fromEntries(filas.map((f) => [f.idEjercicio, Number(f.vacantes)]));
  }

  /**
   * El catalogo de ofertas abiertas (pantalla «explorar»).
   *
   * Es la mitad de la contradiccion §6.2 que si se puede cerrar sin inventar
   * nada: hasta ahora un candidato solo veia las vacantes a las que alguien lo
   * invito, asi que no habia forma de encontrar trabajo en MeritIA. Lo que NO
   * hace es ordenar por afinidad: eso necesita un perfil de habilidades que no
   * existe. Ver ADR-0015.
   *
   * QUE SE MUESTRA Y QUE NO
   *
   * Solo vacantes **publicadas** de empresas **activas**. Un borrador todavia
   * no esta listo para que nadie lo vea, una cerrada ya no admite a nadie, y
   * una empresa inactiva no puede operar: ensenar sus ofertas seria mandar
   * gente a un proceso que no va a avanzar.
   *
   * De la empresa van nombre y sector, que es lo que hace falta para decidir si
   * te postulas. El NIT no.
   */
  async catalogoAbierto(solicitante: Solicitante): Promise<OfertaDelCatalogo[]> {
    const publicadas = await this.vacantes.find({
      where: { estado: EstadoVacante.Publicada },
      relations: { ejercicios: true },
      order: { publicadaEn: 'DESC' },
    });
    if (publicadas.length === 0) return [];

    const empresas = await this.empresas.resumenesDe(publicadas.map((v) => v.idEmpresa));

    // Lo que este candidato ya pidio o ya tiene. En dos consultas y no en una
    // por fila: con veinte ofertas abiertas eso serian cuarenta viajes.
    const [postuladas, invitadas] = await Promise.all([
      this.postulaciones.find({
        where: { idCandidato: solicitante.id },
        select: { idVacante: true, estado: true },
      }),
      this.asignaciones.find({
        where: { idCandidato: solicitante.id },
        select: { idVacante: true },
      }),
    ]);
    const miPostulacion = new Map(postuladas.map((p) => [p.idVacante, p.estado]));
    const yaInvitado = new Set(invitadas.map((a) => a.idVacante));

    return publicadas
      .filter((v) => empresas.get(v.idEmpresa)?.activa === true)
      .map((v) => {
        const empresa = empresas.get(v.idEmpresa)!;
        return {
          id: v.id,
          titulo: v.titulo,
          descripcion: v.descripcion,
          ubicacion: v.ubicacion,
          modalidad: v.modalidad,
          tecnologias: v.tecnologias,
          empresa: empresa.nombre,
          sector: empresa.sector,
          ejercicios: v.ejercicios?.length ?? 0,
          intentosPorEjercicio: v.intentosPermitidos,
          publicadaEn: v.publicadaEn,
          cierreEstimado: v.cierreEstimado,
          // Para que la pantalla sepa si pintar «Postularme», «En revision» o
          // «Ya participas». Sin esto tendria que adivinarlo o pedirlo aparte.
          miPostulacion: miPostulacion.get(v.id) ?? null,
          yaInvitado: yaInvitado.has(v.id),
        };
      });
  }

  /**
   * Un candidato pide entrar a una vacante publicada.
   *
   * NO DA ACCESO A NADA. Crea una solicitud en revision; lo que da acceso es la
   * invitacion, y esa la crea `aceptarPostulacion`.
   *
   * POR QUE 404 Y NO 400 SI LA VACANTE ES UN BORRADOR
   *
   * Mismo criterio que en el resto del modulo (ADR-0012): responder «esta en
   * borrador» confirma que existe, y con eso se sondea que prepara una empresa
   * probando identificadores. Un borrador no existe para quien no es su dueño.
   */
  async postular(idVacante: string, solicitante: Solicitante): Promise<Postulacion> {
    if (solicitante.rol !== Rol.Candidato) {
      throw new BadRequestException(
        'Solo un candidato se postula. Un reclutador invita, que es el otro camino.',
      );
    }

    const vacante = await this.vacantes.findOne({ where: { id: idVacante } });
    if (!vacante || vacante.estado !== EstadoVacante.Publicada) {
      this.registrar('postulacion_a_vacante_no_disponible', solicitante, { idVacante });
      throw new NotFoundException('La vacante no existe.');
    }

    // Ya invitado: no se le hace pedir permiso para algo que ya tiene. Se le
    // dice, en vez de dejarle una solicitud en revision que nadie resolvera.
    const invitado = await this.asignaciones.exists({
      where: { idVacante, idCandidato: solicitante.id },
    });
    if (invitado) {
      throw new BadRequestException(
        'Ya estas invitado a esta vacante: puedes empezar el reto sin postularte.',
      );
    }

    try {
      const postulacion = await this.postulaciones.save(
        this.postulaciones.create({
          idVacante,
          idCandidato: solicitante.id,
          estado: EstadoPostulacion.EnRevision,
        }),
      );
      this.registrar('postulacion_creada', solicitante, { idVacante });
      // Si la vacante invita sola, se decide AHORA y de forma sincrona, para que
      // la respuesta del POST diga el estado final en vez de dejar al candidato
      // mirando un "en revision" que ya no es verdad.
      return await this.aplicarInvitacionAutomatica(vacante, postulacion);
    } catch (error) {
      // El unico de la base es el que decide, no una comprobacion previa: entre
      // leer y escribir caben dos pulsaciones del mismo boton.
      if (esViolacionDeUnicidad(error)) {
        throw new ConflictException('Ya te postulaste a esta vacante.');
      }
      throw error;
    }
  }

  /**
   * El candidato retira una postulacion que la empresa aun no decidio.
   *
   * Una ya decidida no se retira: la decision es un registro sobre una persona
   * y borrarla la haria desaparecer, con su motivo. Despues de retirar puede
   * volver a postularse mientras la vacante siga publicada.
   */
  async retirarPostulacion(idVacante: string, solicitante: Solicitante): Promise<void> {
    const postulacion = await this.postulaciones.findOne({
      where: { idVacante, idCandidato: solicitante.id },
    });
    if (!postulacion) throw new NotFoundException('No te has postulado a esta vacante.');
    if (postulacion.estado !== EstadoPostulacion.EnRevision) {
      throw new BadRequestException(
        `Tu postulacion ya esta ${postulacion.estado}: solo se retira la que sigue en revision.`,
      );
    }
    await this.postulaciones.delete({ id: postulacion.id });
    this.registrar('postulacion_retirada', solicitante, { idVacante });
  }

  /** Las postulaciones del propio candidato, con la oferta a la que son. */
  async misPostulaciones(solicitante: Solicitante): Promise<Postulacion[]> {
    return this.postulaciones.find({
      where: { idCandidato: solicitante.id },
      relations: { vacante: true },
      order: { creadaEn: 'DESC' },
    });
  }

  /**
   * Los postulantes de una vacante, para el reclutador.
   *
   * SON IDENTIFICADORES, NO PERSONAS, Y ESO ES UNA DECISION INCOMODA
   *
   * No se devuelve nombre ni correo. Es coherente con el nucleo del producto
   * --el ranking oculta la identidad hasta que la empresa la revela-- pero deja
   * al reclutador decidiendo a ciegas, y eso contradice A04, que promete una
   * preseleccion por perfil de habilidades. La contradiccion esta nombrada en
   * el ADR-0015 y en la matriz §6.2: no se resuelve aqui a escondidas.
   */
  async postulacionesDe(idVacante: string, solicitante: Solicitante): Promise<Postulacion[]> {
    const vacante = await this.obtenerCompleta(idVacante);
    this.exigirPropiedad(vacante, solicitante);

    return this.postulaciones.find({
      where: { idVacante },
      order: { creadaEn: 'ASC' },
    });
  }

  /**
   * Acepta a un postulante: lo invita, que es lo que le deja entregar.
   *
   * Las dos escrituras van en una transaccion. Si la invitacion fallara despues
   * de marcar la postulacion como aceptada, el candidato veria «aceptada» y
   * seguiria sin poder entregar: el peor de los dos fallos posibles.
   */
  async aceptarPostulacion(
    idVacante: string,
    idCandidato: string,
    solicitante: Solicitante,
  ): Promise<Postulacion> {
    const vacante = await this.obtenerCompleta(idVacante);
    this.exigirPropiedad(vacante, solicitante);

    if (vacante.estado === EstadoVacante.Cerrada) {
      throw new BadRequestException(
        'La vacante esta cerrada: aceptar a alguien ahora le daria un reto que no se va a evaluar.',
      );
    }

    const postulacion = await this.postulacionPendiente(idVacante, idCandidato);

    return this.dataSource.transaction(async (manager) => {
      const yaInvitado = await manager.getRepository(VacanteCandidato).exists({
        where: { idVacante, idCandidato },
      });
      if (!yaInvitado) {
        await manager
          .getRepository(VacanteCandidato)
          .save(manager.getRepository(VacanteCandidato).create({ idVacante, idCandidato }));
      }

      postulacion.estado = EstadoPostulacion.Aceptada;
      postulacion.idUsuarioQueDecidio = solicitante.id;
      postulacion.decididaEn = new Date();
      const guardada = await manager.getRepository(Postulacion).save(postulacion);

      this.registrar('postulacion_aceptada', solicitante, { idVacante, idCandidato });
      return guardada;
    });
  }

  /**
   * Rechaza a un postulante, con el motivo que el candidato va a leer.
   *
   * El motivo es obligatorio y lo valida el DTO. Es el cimiento del
   * «feedback de por que un candidato no avanzo» que pide el diagrama: sin un
   * texto escrito por quien decidio, no hay nada que mostrarle.
   */
  async rechazarPostulacion(
    idVacante: string,
    idCandidato: string,
    motivo: string,
    solicitante: Solicitante,
  ): Promise<Postulacion> {
    const vacante = await this.obtenerCompleta(idVacante);
    this.exigirPropiedad(vacante, solicitante);

    const postulacion = await this.postulacionPendiente(idVacante, idCandidato);
    postulacion.estado = EstadoPostulacion.Rechazada;
    postulacion.motivoDelRechazo = motivo;
    postulacion.idUsuarioQueDecidio = solicitante.id;
    postulacion.decididaEn = new Date();

    const guardada = await this.postulaciones.save(postulacion);
    // El motivo NO va al registro de seguridad: es un texto libre sobre una
    // persona y los registros se leen en sitios donde ese texto no hace falta.
    this.registrar('postulacion_rechazada', solicitante, { idVacante, idCandidato });
    return guardada;
  }

  /**
   * Registra quien sabe calcular la afinidad.
   *
   * Lo llama `ReportesService` al arrancar. Ver
   * `dominio/calculador-de-afinidad.ts` para por que la llamada va al reves y
   * por que no por el bus de eventos.
   */
  registrarCalculadorDeAfinidad(calculador: CalculadorDeAfinidad): void {
    this.calculadorDeAfinidad = calculador;
  }

  /**
   * Enciende o apaga la invitacion automatica de una vacante (A04).
   *
   * EXIGE QUE EL CALCULO DE AFINIDAD ESTE DISPONIBLE, y falla si no.
   *
   * Encenderla sin calculador dejaria dos salidas malas: inventar un porcentaje,
   * o saltarse el umbral y aceptar a todo el mundo. Las dos serian una funcion
   * que decide sobre personas comportandose distinto de lo que dice su
   * configuracion. Mejor no arrancar.
   *
   * AL ENCENDERLA SE PROCESA LO QUE YA ESTABA PENDIENTE
   *
   * Si no, encenderla no haria nada visible hasta la siguiente postulacion, y
   * quien llevara tres dias esperando seguiria esperando. Es una pasada acotada:
   * las postulaciones en revision de UNA vacante.
   */
  async configurarInvitacionAutomatica(
    id: string,
    politica: PoliticaDeInvitacion,
    solicitante: Solicitante,
  ): Promise<{ vacante: Vacante; aceptadas: number }> {
    const vacante = await this.obtenerCompleta(id);
    this.exigirPropiedad(vacante, solicitante);

    if (politica.activa && this.calculadorDeAfinidad === null) {
      throw new BadRequestException(
        'La invitacion automatica no se puede encender: el calculo de afinidad no esta disponible en esta instancia.',
      );
    }
    if (vacante.estado === EstadoVacante.Cerrada) {
      throw new BadRequestException('Una vacante cerrada no invita a nadie.');
    }

    vacante.invitacionAutomatica = politica.activa;
    vacante.umbralDeAfinidad = politica.umbral;
    vacante.cupoDeInvitacionAutomatica = politica.cupo;
    await this.vacantes.save(vacante);

    this.registrar('invitacion_automatica_configurada', solicitante, {
      idVacante: id,
      activa: politica.activa,
      umbral: politica.umbral,
      cupo: politica.cupo,
    });

    let aceptadas = 0;
    if (politica.activa) {
      const pendientes = await this.postulaciones.find({
        where: { idVacante: id, estado: EstadoPostulacion.EnRevision },
        order: { creadaEn: 'ASC' },
      });
      // En orden de llegada: si hay cupo, lo justo es que lo coja quien se
      // postulo antes y no quien el `find` devuelva primero.
      for (const pendiente of pendientes) {
        const despues = await this.aplicarInvitacionAutomatica(
          await this.obtenerCompleta(id),
          pendiente,
        );
        if (despues.estado === EstadoPostulacion.Aceptada) aceptadas += 1;
      }
    }

    return { vacante: await this.obtenerCompleta(id), aceptadas };
  }

  /**
   * Aplica la politica de la vacante a una postulacion recien creada o pendiente.
   *
   * Devuelve la postulacion como queda: aceptada si entro sola, igual si no.
   * NUNCA la rechaza --ver `dominio/politica-de-invitacion.ts`-- asi que lo peor
   * que puede pasar es que se quede esperando a una persona, que es donde
   * estaria si esta funcion no existiera.
   */
  private async aplicarInvitacionAutomatica(
    vacante: Vacante,
    postulacion: Postulacion,
  ): Promise<Postulacion> {
    const calculador = this.calculadorDeAfinidad;
    if (!vacante.invitacionAutomatica || calculador === null) return postulacion;

    const politica: PoliticaDeInvitacion = {
      activa: vacante.invitacionAutomatica,
      umbral: vacante.umbralDeAfinidad,
      cupo: vacante.cupoDeInvitacionAutomatica,
    };

    // Solo se pide la afinidad si la politica la va a mirar: en modo abierto no
    // hace falta, y es una consulta de agregacion por candidato.
    let afinidad: number | null = null;
    if (politica.umbral !== null) {
      afinidad = await calculador.porcentajeDe(postulacion.idCandidato, vacante.id);
    }

    const emitidas = await this.postulaciones.count({
      where: {
        idVacante: vacante.id,
        decisionAutomatica: true,
        estado: EstadoPostulacion.Aceptada,
      },
    });

    const decision = decidirInvitacionAutomatica(politica, vacante.estado, afinidad, emitidas);

    if (!decision.acepta) {
      this.registrar(
        'invitacion_automatica_no_aplicada',
        { ...SISTEMA, id: vacante.idReclutador },
        {
          idVacante: vacante.id,
          idCandidato: postulacion.idCandidato,
          motivo: decision.motivo,
        },
      );
      return postulacion;
    }

    return this.dataSource.transaction(async (manager) => {
      const yaInvitado = await manager
        .getRepository(VacanteCandidato)
        .exists({ where: { idVacante: vacante.id, idCandidato: postulacion.idCandidato } });
      if (!yaInvitado) {
        await manager
          .getRepository(VacanteCandidato)
          .save(
            manager
              .getRepository(VacanteCandidato)
              .create({ idVacante: vacante.id, idCandidato: postulacion.idCandidato }),
          );
      }

      postulacion.estado = EstadoPostulacion.Aceptada;
      postulacion.decisionAutomatica = true;
      postulacion.afinidadAlDecidir = decision.afinidad;
      // Quien encendio la politica responde por lo que la maquina acepte, asi
      // que no se pierde el responsable: se guarda el reclutador de la vacante.
      postulacion.idUsuarioQueDecidio = vacante.idReclutador;
      postulacion.decididaEn = new Date();
      const guardada = await manager.getRepository(Postulacion).save(postulacion);

      this.registrar(
        'invitacion_automatica_emitida',
        { ...SISTEMA, id: vacante.idReclutador },
        {
          idVacante: vacante.id,
          idCandidato: postulacion.idCandidato,
          afinidad: decision.afinidad,
          umbral: politica.umbral,
        },
      );
      return guardada;
    });
  }

  /**
   * La postulacion que todavia se puede decidir.
   *
   * Una ya decidida devuelve 400 y no 404: aqui el reclutador ya demostro que
   * la vacante es suya, asi que decirle «esa ya la resolviste» no le revela
   * nada que no supiera, y le explica por que el boton no hizo nada.
   */
  private async postulacionPendiente(idVacante: string, idCandidato: string): Promise<Postulacion> {
    const postulacion = await this.postulaciones.findOne({
      where: { idVacante, idCandidato },
    });
    if (!postulacion) {
      throw new NotFoundException('Esa persona no se postulo a esta vacante.');
    }
    if (!puedeDecidirse(postulacion.estado)) {
      throw new BadRequestException(
        `Esta postulacion ya esta ${postulacion.estado}: una decision sobre una persona no se reescribe.`,
      );
    }
    return postulacion;
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
  /** Las publicadas, con su plan. El avance lo completa reportes. */
  abiertas: VacanteAbierta[];
}

/**
 * Una vacante abierta tal como la ve el panel.
 *
 * Lleva `invitados` porque es el denominador del avance y solo este modulo
 * sabe a quien se invito. No lleva el avance: eso necesita saber quien entrego
 * y quien ya tiene evaluacion, y preguntarselo desde aqui cerraria un ciclo
 * entre modulos. Lo compone reportes, que es el unico autorizado a mezclar.
 */
export interface VacanteAbierta {
  id: string;
  titulo: string;
  cierreEstimado: Date | null;
  finalistasAEvaluar: number | null;
  publicadaEn: Date | null;
  invitados: number;
}

/** Lo que vence antes, primero; lo que no tiene estimado, al final. */
function compararPorCierre(a: VacanteAbierta, b: VacanteAbierta): number {
  if (a.cierreEstimado && b.cierreEstimado) {
    return a.cierreEstimado.getTime() - b.cierreEstimado.getTime();
  }
  if (a.cierreEstimado) return -1;
  if (b.cierreEstimado) return 1;
  // Ninguna tiene estimado: la mas reciente arriba, como el resto de listados.
  return (b.publicadaEn?.getTime() ?? 0) - (a.publicadaEn?.getTime() ?? 0);
}

/** Lo justo para redactar el aviso de cierre de una vacante. */
export interface DatosParaNotificar {
  readonly idVacante: string;
  readonly titulo: string;
  readonly idEmpresa: string;
  readonly estado: EstadoVacante;
}

/** Una oferta tal como se ve en el catalogo abierto, sin datos de la empresa que no hagan falta. */
export interface OfertaDelCatalogo {
  id: string;
  titulo: string;
  descripcion: string;
  ubicacion: string | null;
  modalidad: Modalidad | null;
  tecnologias: string[];
  empresa: string;
  sector: SectorEmpresa;
  ejercicios: number;
  intentosPorEjercicio: number;
  publicadaEn: Date | null;
  cierreEstimado: Date | null;
  /** Estado de la postulacion de quien pregunta, o null si no se postulo. */
  miPostulacion: EstadoPostulacion | null;
  yaInvitado: boolean;
}

function esViolacionDeUnicidad(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
