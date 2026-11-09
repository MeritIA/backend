import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Entrega } from './entities/entrega.entity.js';
import { HistorialEstadoEntrega } from './entities/historial-estado-entrega.entity.js';
import { SesionesService } from './sesiones.service.js';
import { EstadoEntrega, puedeTransicionar } from './dominio/estado-entrega.js';
import { ENTREGA_COMPLETADA, type EventoEntregaCompletada } from './dominio/eventos.js';
import { ConsentimientosService, Rol, TipoDeConsentimiento } from '../autenticacion/index.js';
import { VacantesService, type Solicitante } from '../vacantes/index.js';
import {
  AlmacenamientoService,
  ArchivoInvalidoError,
  extensionValidada,
  type ReferenciaDeObjeto,
} from '../../common/almacenamiento/index.js';
import { BusDeEventos } from '../../common/events/index.js';

/** Lo minimo que necesitamos del archivo recibido, sin atarnos a multer. */
export interface ArchivoSubido {
  readonly originalname: string;
  readonly buffer: Buffer;
  readonly size: number;
}

export class TransicionInvalidaError extends Error {}

export interface DatosParaEvaluacion {
  readonly idEntrega: string;
  readonly idVacante: string;
  readonly idCandidato: string;
  readonly idEjercicio: string;
  readonly numeroIntento: number;
  readonly estado: EstadoEntrega;
}

/**
 * El tipo de contenido se deduce de la extension ya validada, NO del que
 * declara el cliente. La cabecera Content-Type de una subida la escribe quien
 * sube, y fiarse de ella es aceptar `text/html` en un archivo llamado .pdf.
 */
const TIPOS_POR_EXTENSION: Record<string, string> = {
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.ipynb': 'application/x-ipynb+json',
  '.sql': 'application/sql',
  '.json': 'application/json',
};

/**
 * Modulo de entregas, paquete 3.4.
 *
 * Criterios de aceptacion:
 *  1. Un candidato no puede exceder el numero de intentos permitido.
 *  2. El estado de cada intento es consultable y trazable.
 *  3. La entrega completada dispara el evento de evaluacion sin acoplamiento
 *     directo entre modulos.
 */
@Injectable()
export class EntregasService {
  private readonly logger = new Logger('Entregas');

  constructor(
    @InjectRepository(Entrega) private readonly entregas: Repository<Entrega>,
    @InjectRepository(HistorialEstadoEntrega)
    private readonly historial: Repository<HistorialEstadoEntrega>,
    private readonly dataSource: DataSource,
    private readonly vacantes: VacantesService,
    private readonly consentimientos: ConsentimientosService,
    private readonly almacen: AlmacenamientoService,
    private readonly sesiones: SesionesService,
    private readonly bus: BusDeEventos,
  ) {}

  /**
   * Recibe un intento del candidato.
   *
   * EL LIMITE DE INTENTOS BAJO CONCURRENCIA
   *
   * Contar los intentos y luego insertar no basta: dos subidas simultaneas
   * cuentan las dos "cero" y guardan las dos. Por eso todo ocurre dentro de una
   * transaccion que toma un bloqueo consultivo de PostgreSQL sobre la
   * combinacion vacante + candidato + ejercicio. Solo serializa las subidas de
   * ESE candidato a ESE ejercicio; las de los demas no esperan. El indice unico
   * sobre el numero de intento es la red de seguridad si el bloqueo fallara.
   *
   * EL ARCHIVO Y LA FILA
   *
   * El archivo se sube dentro de la transaccion, despues de comprobar el limite
   * y antes de insertar. Si la insercion o el commit fallan, se borra el objeto:
   * sin esa compensacion quedarian archivos huerfanos en el bucket, que cuestan
   * dinero y contienen datos de candidatos que nadie puede ver ni borrar.
   *
   * EL EVENTO
   *
   * Se publica DESPUES del commit. Si se publicara dentro, un suscriptor podria
   * ir a buscar una entrega que todavia no existe para nadie mas.
   */
  async entregar(
    idVacante: string,
    idEjercicio: string,
    archivo: ArchivoSubido | undefined,
    solicitante: Solicitante,
  ): Promise<Entrega> {
    if (!archivo) {
      throw new BadRequestException('Falta el archivo de la entrega (campo "archivo").');
    }

    // 404 y no 403: no se confirma que exista una vacante a la que no se tiene acceso.
    if (!(await this.vacantes.puedeRecibirEntrega(idVacante, solicitante.id))) {
      this.registrar('entrega_rechazada_sin_acceso', solicitante, { idVacante });
      throw new NotFoundException('La vacante no existe o no acepta entregas.');
    }

    // Antes de tocar el archivo: si el candidato revoco el permiso de
    // calificacion por IA, su entregable no puede ir al servicio de evaluacion.
    // Se comprueba DESPUES del acceso para no contarle a un desconocido que la
    // vacante existe, y ANTES de subir nada para no dejar en el bucket un
    // archivo que nadie va a poder evaluar.
    await this.exigirConsentimientoDeEvaluacion(solicitante);

    const ejercicios = await this.vacantes.idsDeEjerciciosDe(idVacante);
    if (!ejercicios.includes(idEjercicio)) {
      throw new BadRequestException('El ejercicio no pertenece a esta vacante.');
    }

    // Despues de comprobar que el ejercicio es de la vacante: el reloj es del servidor.
    await this.sesiones.exigirVigente(idVacante, idEjercicio, solicitante.id);

    let tipoContenido: string;
    try {
      tipoContenido = TIPOS_POR_EXTENSION[extensionValidada(archivo.originalname)];
    } catch (e) {
      if (e instanceof ArchivoInvalidoError) throw new BadRequestException(e.message);
      throw e;
    }

    const limite = await this.vacantes.intentosPermitidosPara(idVacante);
    const idEntrega = randomUUID();
    let referencia: ReferenciaDeObjeto | undefined;

    try {
      const entrega = await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${idVacante}:${solicitante.id}:${idEjercicio}`,
        ]);

        const usados = await manager.count(Entrega, {
          where: { idVacante, idCandidato: solicitante.id, idEjercicio },
        });
        if (usados >= limite) {
          throw new ConflictException(
            `Has usado los ${limite} intento(s) permitidos para este ejercicio.`,
          );
        }

        try {
          referencia = await this.almacen.subirEntrega(
            idVacante,
            idEntrega,
            archivo.originalname,
            archivo.buffer,
            tipoContenido,
          );
        } catch (e) {
          if (e instanceof ArchivoInvalidoError) throw new BadRequestException(e.message);
          throw e;
        }

        const nueva = await manager.save(
          manager.create(Entrega, {
            id: idEntrega,
            idVacante,
            idCandidato: solicitante.id,
            idEjercicio,
            numeroIntento: usados + 1,
            estado: EstadoEntrega.Recibida,
            archivoClave: referencia.clave,
            archivoBytes: referencia.bytes,
            archivoSha256: referencia.sha256,
            archivoTipo: referencia.tipoContenido,
            archivoNombre: referencia.nombreOriginal,
          }),
        );
        await manager.save(
          manager.create(HistorialEstadoEntrega, {
            idEntrega,
            desde: null,
            hacia: EstadoEntrega.Recibida,
            motivo: 'Entrega del candidato',
          }),
        );
        return nueva;
      });

      this.registrar('entrega_recibida', solicitante, {
        idEntrega,
        idVacante,
        numeroIntento: entrega.numeroIntento,
      });

      this.bus.publicar<EventoEntregaCompletada>({
        name: ENTREGA_COMPLETADA,
        occurredAt: new Date(),
        payload: {
          idEntrega,
          idVacante,
          idCandidato: solicitante.id,
          idEjercicio,
          numeroIntento: entrega.numeroIntento,
        },
      });

      return this.obtenerConHistorial(idEntrega);
    } catch (e) {
      if (referencia) {
        await this.almacen.eliminar(referencia).catch((error: unknown) => {
          // No se tapa el error original, pero un huerfano tiene que quedar visto.
          this.logger.error(
            JSON.stringify({
              level: 'error',
              eventType: 'objeto_huerfano',
              clave: referencia?.clave,
              detalle: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      }
      throw e;
    }
  }

  /** Intentos del propio candidato, opcionalmente de una vacante. */
  async mias(solicitante: Solicitante, idVacante?: string): Promise<Entrega[]> {
    return this.entregas.find({
      where: { idCandidato: solicitante.id, ...(idVacante ? { idVacante } : {}) },
      order: { creadaEn: 'DESC' },
    });
  }

  /** Entregas de una vacante, para su reclutador o un administrador. */
  async deVacante(idVacante: string, solicitante: Solicitante): Promise<Entrega[]> {
    if (!(await this.vacantes.puedeVerEntregasDe(idVacante, solicitante))) {
      this.registrar('acceso_denegado_por_recurso', solicitante, { idVacante });
      throw new NotFoundException('La vacante no existe.');
    }
    return this.entregas.find({ where: { idVacante }, order: { creadaEn: 'DESC' } });
  }

  /**
   * Cuantas entregas hay de la vacante en cada estado.
   *
   * Lo pide el reporte del paquete 5.1, que necesita saber si el ranking esta
   * completo o si todavia falta gente por evaluar.
   *
   * Cuenta en la base y no cargando las filas: el nombre del archivo esta
   * cifrado en reposo, asi que traer cada entrega para contarlas obligaria a
   * descifrar un dato personal que al reporte no le hace ninguna falta. Ademas
   * una vacante con cientos de entregas no tiene por que viajar entera para
   * producir cuatro numeros.
   */
  async conteosPorEstado(
    idVacante: string,
    solicitante: Solicitante,
  ): Promise<Record<EstadoEntrega, number>> {
    if (!(await this.vacantes.puedeVerEntregasDe(idVacante, solicitante))) {
      this.registrar('acceso_denegado_por_recurso', solicitante, { idVacante });
      throw new NotFoundException('La vacante no existe.');
    }

    const filas = await this.entregas
      .createQueryBuilder('e')
      .select('e.estado', 'estado')
      .addSelect('count(*)::int', 'total')
      .where('e.id_vacante = :idVacante', { idVacante })
      .groupBy('e.estado')
      .getRawMany<{ estado: EstadoEntrega; total: number }>();

    // Todos los estados presentes aunque esten en cero: asi quien lee el
    // reporte no tiene que distinguir "cero" de "no vino el dato".
    const conteos = Object.fromEntries(
      Object.values(EstadoEntrega).map((estado) => [estado, 0]),
    ) as Record<EstadoEntrega, number>;
    for (const fila of filas) conteos[fila.estado] = Number(fila.total);
    return conteos;
  }

  /**
   * Los mismos conteos, pero de varias vacantes a la vez.
   *
   * Para el panel de la empresa (A02): una llamada por vacante convertiria
   * cuatro cifras en decenas de consultas.
   *
   * NO COMPRUEBA ACCESO, Y NO ES UN DESCUIDO: no puede. Recibe una lista de
   * identificadores, no una peticion, y quien la llama —el panel de reportes—
   * los obtiene del modulo de vacantes usando la empresa del token, nunca un
   * parametro de la URL. Ahi no hay identificador que un atacante pueda
   * cambiar. Si algun dia la llama alguien mas, la comprobacion le toca a el.
   */
  async conteosPorEstadoDeVacantes(
    idsDeVacantes: readonly string[],
  ): Promise<Record<EstadoEntrega, number>> {
    const conteos = Object.fromEntries(
      Object.values(EstadoEntrega).map((estado) => [estado, 0]),
    ) as Record<EstadoEntrega, number>;

    // Sin vacantes no hay nada que contar, y un `IN ()` vacio es SQL invalido.
    if (idsDeVacantes.length === 0) return conteos;

    const filas = await this.entregas
      .createQueryBuilder('e')
      .select('e.estado', 'estado')
      .addSelect('count(*)::int', 'total')
      .where('e.id_vacante IN (:...idsDeVacantes)', { idsDeVacantes })
      .groupBy('e.estado')
      .getRawMany<{ estado: EstadoEntrega; total: number }>();

    for (const fila of filas) conteos[fila.estado] = Number(fila.total);
    return conteos;
  }

  /**
   * Cuantas PERSONAS distintas tienen una entrega pendiente de evaluar.
   *
   * Es la cifra que la pantalla A02 llama "finalistas en evaluacion". No es lo
   * mismo que contar entregas: quien reintenta tiene dos, y el panel diria que
   * hay dos personas esperando donde hay una. El conteo por estado se queda
   * para saber si el ranking esta completo; este, para el panel.
   *
   * Sobre el acceso vale lo dicho en `conteosPorEstadoDeVacantes`.
   */
  async candidatosEnEvaluacionDeVacantes(idsDeVacantes: readonly string[]): Promise<number> {
    if (idsDeVacantes.length === 0) return 0;

    const fila = await this.entregas
      .createQueryBuilder('e')
      .select('count(distinct e.id_candidato)::int', 'total')
      .where('e.id_vacante IN (:...idsDeVacantes)', { idsDeVacantes })
      .andWhere('e.estado IN (:...estados)', {
        estados: [EstadoEntrega.Recibida, EstadoEntrega.EnEvaluacion],
      })
      .getRawOne<{ total: number }>();

    return Number(fila?.total ?? 0);
  }

  /**
   * Cuantas PERSONAS distintas han entregado algo, vacante por vacante.
   *
   * Es la mitad del "avance" de cada tarjeta de A02. Va separado de los
   * conteos por estado porque responde otra pregunta: aquellos dicen en que
   * punto esta la cola, y este dice cuanta gente de la invitada se movio. Un
   * proceso donde nadie entrega y otro donde todos entregaron y la cola va
   * lenta se ven iguales en el conteo por estado, y piden cosas distintas del
   * reclutador.
   *
   * Cuenta `distinct id_candidato`: quien reintenta sigue siendo una persona.
   *
   * Sobre el acceso vale lo dicho en `conteosPorEstadoDeVacantes`.
   */
  async candidatosConEntregaPorVacante(
    idsDeVacantes: readonly string[],
  ): Promise<Record<string, number>> {
    if (idsDeVacantes.length === 0) return {};

    const filas = await this.entregas
      .createQueryBuilder('e')
      .select('e.id_vacante', 'idVacante')
      .addSelect('count(distinct e.id_candidato)::int', 'total')
      .where('e.id_vacante IN (:...idsDeVacantes)', { idsDeVacantes })
      .groupBy('e.id_vacante')
      .getRawMany<{ idVacante: string; total: number }>();

    return Object.fromEntries(filas.map((f) => [f.idVacante, Number(f.total)]));
  }

  async obtenerPara(id: string, solicitante: Solicitante): Promise<Entrega> {
    const entrega = await this.obtenerConHistorial(id);
    await this.exigirAcceso(entrega, solicitante);
    return entrega;
  }

  async enlaceDeDescarga(
    id: string,
    solicitante: Solicitante,
  ): Promise<{ url: string; expiraEnSegundos: number }> {
    const entrega = await this.obtenerConHistorial(id);
    await this.exigirAcceso(entrega, solicitante);
    const url = await this.almacen.enlaceDeDescarga(this.referenciaDeEntrega(entrega));
    this.registrar('descarga_de_entrega', solicitante, { idEntrega: id });
    return { url, expiraEnSegundos: 300 };
  }

  // --- Puerta para el modulo de evaluacion ---

  /**
   * Cambia el estado de una entrega y deja constancia en el historial.
   *
   * La usara el modulo de evaluacion. Bloquea la fila: dos evaluaciones que
   * intentaran tomar la misma entrega a la vez no pueden pasar ambas de
   * `recibida` a `en_evaluacion`.
   */
  async cambiarEstado(idEntrega: string, hacia: EstadoEntrega, motivo: string): Promise<Entrega> {
    await this.dataSource.transaction(async (manager) => {
      const entrega = await manager.findOne(Entrega, {
        where: { id: idEntrega },
        lock: { mode: 'pessimistic_write' },
      });
      if (!entrega) throw new NotFoundException('La entrega no existe.');
      if (!puedeTransicionar(entrega.estado, hacia)) {
        throw new TransicionInvalidaError(
          `Una entrega en estado "${entrega.estado}" no puede pasar a "${hacia}".`,
        );
      }

      const desde = entrega.estado;
      entrega.estado = hacia;
      await manager.save(entrega);
      await manager.save(
        manager.create(HistorialEstadoEntrega, { idEntrega, desde, hacia, motivo }),
      );
    });
    return this.obtenerConHistorial(idEntrega);
  }

  /**
   * Entregas recibidas que llevan mas de `antiguedadMs` sin pasar a evaluacion.
   *
   * El evento de entrega completada viaja en memoria: si el proceso cae entre
   * el commit y el encolado, la entrega quedaria en `recibida` para siempre.
   * Evaluacion usa esta consulta al arrancar para volver a encolarlas.
   */
  async pendientesDeEvaluacion(antiguedadMs: number, limite = 500): Promise<string[]> {
    const filas = await this.entregas
      .createQueryBuilder('e')
      .select('e.id', 'id')
      .where('e.estado = :estado', { estado: EstadoEntrega.Recibida })
      .andWhere('e.creadaEn < :corte', { corte: new Date(Date.now() - antiguedadMs) })
      .orderBy('e.creadaEn', 'ASC')
      .limit(limite)
      .getRawMany<{ id: string }>();
    return filas.map((f) => f.id);
  }

  /**
   * Lo que evaluacion necesita de una entrega, sin control de acceso.
   *
   * No hay usuario detras: la llama el worker de la cola. Devuelve solo
   * identificadores y estado, nunca el nombre del archivo ni datos personales.
   */
  async datosParaEvaluacion(idEntrega: string): Promise<DatosParaEvaluacion | null> {
    const e = await this.entregas.findOne({
      where: { id: idEntrega },
      select: {
        id: true,
        idVacante: true,
        idCandidato: true,
        idEjercicio: true,
        numeroIntento: true,
        estado: true,
      },
    });
    return e
      ? {
          idEntrega: e.id,
          idVacante: e.idVacante,
          idCandidato: e.idCandidato,
          idEjercicio: e.idEjercicio,
          numeroIntento: e.numeroIntento,
          estado: e.estado,
        }
      : null;
  }

  /** Referencia al archivo, para que evaluacion lo descargue. */
  async referenciaDe(idEntrega: string): Promise<ReferenciaDeObjeto> {
    return this.referenciaDeEntrega(await this.obtenerConHistorial(idEntrega));
  }

  // --- Interno ---

  /**
   * Exige el permiso de calificacion por IA antes de aceptar una entrega.
   *
   * POR QUE AQUI Y NO AL EVALUAR
   *
   * Porque aqui se le puede decir a la persona. Si se comprobara solo en el
   * trabajo de la cola, el candidato subiria su entregable, se quedaria
   * esperando y nadie le explicaria nunca por que no llega la nota. La
   * respuesta inmediata dice lo que pasa y como arreglarlo.
   *
   * QUE PASA CON UNA ENTREGA YA HECHA
   *
   * Nada: revocar el permiso NO detiene una entrega que ya esta en la cola. La
   * revocacion de la Ley 1581 mira hacia adelante —detiene tratamientos
   * futuros— y ese entregable se envio bajo un consentimiento que en ese
   * momento era valido. Es un limite conocido y esta escrito en la D-17; la
   * ventana es de minutos y cerrarla obligaria a inventar un estado de entrega
   * que hoy no existe.
   *
   * 403 Y NO 404
   *
   * El candidato si tiene acceso a esta vacante: lo que pasa es que tomo una
   * decision sobre sus datos que tiene esta consecuencia. Esconderselo detras
   * de un "no existe" seria mentirle sobre algo que el mismo eligio.
   */
  private async exigirConsentimientoDeEvaluacion(solicitante: Solicitante): Promise<void> {
    const autoriza = await this.consentimientos.autoriza(
      solicitante.id,
      TipoDeConsentimiento.CalificacionIA,
    );
    if (autoriza) return;

    this.registrar('entrega_rechazada_sin_consentimiento', solicitante, {
      tipo: TipoDeConsentimiento.CalificacionIA,
    });
    throw new ForbiddenException(
      'Revocaste el permiso de calificacion por IA, y sin el tu entregable no se puede ' +
        'evaluar. Puedes volver a concederlo en Mi perfil > Privacidad y entregar de nuevo.',
    );
  }

  private async obtenerConHistorial(id: string): Promise<Entrega> {
    const entrega = await this.entregas.findOne({
      where: { id },
      relations: { historial: true },
      order: { historial: { momento: 'ASC' } },
    });
    if (!entrega) throw new NotFoundException('La entrega no existe.');
    return entrega;
  }

  /** El candidato autor, o quien puede ver las entregas de la vacante. */
  private async exigirAcceso(entrega: Entrega, solicitante: Solicitante): Promise<void> {
    if (solicitante.rol === Rol.Candidato && entrega.idCandidato === solicitante.id) return;
    if (
      solicitante.rol !== Rol.Candidato &&
      (await this.vacantes.puedeVerEntregasDe(entrega.idVacante, solicitante))
    ) {
      return;
    }
    this.registrar('acceso_denegado_por_recurso', solicitante, { idEntrega: entrega.id });
    throw new NotFoundException('La entrega no existe.');
  }

  private referenciaDeEntrega(entrega: Entrega): ReferenciaDeObjeto {
    return {
      clave: entrega.archivoClave,
      bytes: entrega.archivoBytes,
      sha256: entrega.archivoSha256,
      tipoContenido: entrega.archivoTipo,
      nombreOriginal: entrega.archivoNombre,
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
