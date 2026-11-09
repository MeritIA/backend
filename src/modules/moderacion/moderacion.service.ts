import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Caso,
  HORAS_DE_SLA,
  type EstadoDeCaso,
  type OrigenDeCaso,
} from './entities/caso.entity.js';
import { AutenticacionService } from '../autenticacion/index.js';
import {
  EVALUACION_FINALIZADA,
  EvaluacionService,
  type EventoEvaluacionFinalizada,
} from '../evaluacion/index.js';
import { aliasDeCandidato } from '../reportes/index.js';
import { BusDeEventos } from '../../common/events/index.js';

export interface FilaDeCaso {
  id: string;
  alias: string;
  origen: OrigenDeCaso;
  estado: EstadoDeCaso;
  creadoEn: Date;
  venceEn: Date;
  /** Paso el plazo de 24 h sin decision. */
  vencido: boolean;
}

export interface MiCaso {
  id: string;
  idVacante: string;
  origen: OrigenDeCaso;
  estado: EstadoDeCaso;
  creadoEn: Date;
  decididoEn: Date | null;
  /** Lo que escribio el moderador. Solo se muestra una vez decidido. */
  justificacion: string | null;
  /** Una confirmacion se puede disputar una vez, ante otro moderador. */
  puedeDisputar: boolean;
}

/** Fraccion de evaluaciones que se revisan al azar como control de calidad. */
const MUESTREO_POR_OMISION = 0.05;

/**
 * Moderacion de evaluaciones (Flujo C).
 *
 * EL MODERADOR NO VE QUIEN ES
 *
 * Cada caso lleva el alias del ranking (`Candidato ••••3f8a2c`), nunca nombre ni
 * correo. Los moderadores son personal de la plataforma y no pertenecen a
 * ninguna empresa, asi que ninguno puede ser del equipo que diseno la rubrica
 * (regla de C25): esa separacion es estructural, no una comprobacion.
 *
 * QUE DECIDE UNA DECISION
 *
 * `confirmar` descalifica la evaluacion: sale del ranking y de las lecturas de
 * la empresa, y se conserva para el candidato y la auditoria. `restaurar` la
 * deja, o la devuelve si estaba descalificada. Toda decision lleva
 * justificacion, que el candidato lee.
 *
 * LA DISPUTA
 *
 * Una confirmacion se puede disputar UNA vez. La disputa es un caso nuevo que
 * tiene que decidir otro moderador distinto del que confirmo.
 */
@Injectable()
export class ModeracionService implements OnModuleInit {
  private readonly logger = new Logger('Moderacion');
  private readonly muestreo: number;

  constructor(
    @InjectRepository(Caso) private readonly casos: Repository<Caso>,
    private readonly evaluacion: EvaluacionService,
    private readonly autenticacion: AutenticacionService,
    private readonly bus: BusDeEventos,
  ) {
    const configurado = Number(process.env.MODERACION_MUESTREO);
    this.muestreo =
      process.env.MODERACION_MUESTREO !== undefined &&
      Number.isFinite(configurado) &&
      configurado >= 0 &&
      configurado <= 1
        ? configurado
        : MUESTREO_POR_OMISION;
  }

  onModuleInit(): void {
    this.bus.suscribir<EventoEvaluacionFinalizada>(EVALUACION_FINALIZADA, async (evento) => {
      await this.abrirSiCorresponde(evento.payload.idEvaluacion);
    });
  }

  /** Abre un caso si la evaluacion tiene riesgo alto, o si sale en el muestreo. Idempotente. */
  async abrirSiCorresponde(idEvaluacion: string): Promise<Caso | null> {
    const e = await this.evaluacion.paraRevision(idEvaluacion);
    if (!e) return null;
    const origen: OrigenDeCaso | null =
      e.riesgo === 'alto' ? 'antifraude' : Math.random() < this.muestreo ? 'muestreo' : null;
    if (!origen) return null;
    return this.abrir(e.idEvaluacion, e.idVacante, e.idCandidato, origen);
  }

  /** Abre un caso a mano o por la regla; la unicidad por evaluacion y origen lo hace idempotente. */
  async abrir(
    idEvaluacion: string,
    idVacante: string,
    idCandidato: string,
    origen: OrigenDeCaso,
    extra: { idCasoOrigen?: string; explicacion?: string } = {},
  ): Promise<Caso | null> {
    const ahora = new Date();
    try {
      const caso = await this.casos.save(
        this.casos.create({
          idEvaluacion,
          idVacante,
          idCandidato,
          origen,
          estado: 'abierto',
          idCasoOrigen: extra.idCasoOrigen ?? null,
          explicacionDeLaDisputa: extra.explicacion ?? null,
          creadoEn: ahora,
          venceEn: new Date(ahora.getTime() + HORAS_DE_SLA * 3_600_000),
        }),
      );
      this.logger.log(JSON.stringify({ eventType: 'caso_abierto', idCaso: caso.id, origen }));
      return caso;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return null; // ya existia
      throw e;
    }
  }

  // --- Lo que ve el moderador ---

  async bandeja(estado: EstadoDeCaso = 'abierto'): Promise<FilaDeCaso[]> {
    const filas = await this.casos.find({
      where: { estado },
      order: { venceEn: 'ASC' },
      take: 200,
    });
    const ahora = Date.now();
    return filas.map((c) => ({
      id: c.id,
      alias: aliasDeCandidato(c.idVacante, c.idCandidato),
      origen: c.origen,
      estado: c.estado,
      creadoEn: c.creadoEn,
      venceEn: c.venceEn,
      vencido: c.estado === 'abierto' && c.venceEn.getTime() < ahora,
    }));
  }

  async detalle(id: string) {
    const caso = await this.obtener(id);
    const evidencia = await this.evaluacion.paraRevision(caso.idEvaluacion);
    if (!evidencia) throw new NotFoundException('La evaluacion del caso ya no existe.');
    return {
      caso: {
        id: caso.id,
        alias: aliasDeCandidato(caso.idVacante, caso.idCandidato),
        origen: caso.origen,
        estado: caso.estado,
        creadoEn: caso.creadoEn,
        venceEn: caso.venceEn,
        explicacionDeLaDisputa: caso.explicacionDeLaDisputa,
        justificacion: caso.justificacion,
        decididoEn: caso.decididoEn,
        idModerador: caso.idModerador,
      },
      evidencia: {
        notaFinal: evidencia.notaFinal,
        riesgo: evidencia.riesgo,
        puntajeInyeccion: evidencia.puntajeInyeccion,
        banderas: evidencia.banderas,
        descalificada: evidencia.descalificada,
        criterios: evidencia.criterios,
      },
    };
  }

  async decidir(
    id: string,
    decision: 'confirmar' | 'restaurar',
    justificacion: string,
    idModerador: string,
  ): Promise<Caso> {
    const caso = await this.obtener(id);
    if (caso.estado !== 'abierto') {
      throw new BadRequestException(
        `El caso ya esta ${caso.estado}: una decision no se reescribe.`,
      );
    }
    if (caso.origen === 'disputa') {
      const original = caso.idCasoOrigen
        ? await this.casos.findOne({ where: { id: caso.idCasoOrigen } })
        : null;
      if (original?.idModerador === idModerador) {
        throw new ForbiddenException(
          'Una disputa la decide otro moderador, distinto del que confirmo la descalificacion.',
        );
      }
    }
    const nuevoEstado: EstadoDeCaso = decision === 'confirmar' ? 'confirmado' : 'restaurado';
    caso.estado = nuevoEstado;
    caso.justificacion = justificacion.trim();
    caso.idModerador = idModerador;
    caso.decididoEn = new Date();
    const guardado = await this.casos.save(caso);
    await this.evaluacion.marcarDescalificada(caso.idEvaluacion, decision === 'confirmar');
    this.logger.log(
      JSON.stringify({ eventType: 'caso_decidido', idCaso: id, decision, idModerador }),
    );
    return guardado;
  }

  // --- Lo que ve el candidato ---

  async misCasos(idCandidato: string): Promise<MiCaso[]> {
    const filas = await this.casos.find({ where: { idCandidato }, order: { creadoEn: 'DESC' } });
    const disputados = new Set(
      filas.filter((c) => c.origen === 'disputa' && c.idCasoOrigen).map((c) => c.idCasoOrigen),
    );
    return filas.map((c) => ({
      id: c.id,
      idVacante: c.idVacante,
      origen: c.origen,
      estado: c.estado,
      creadoEn: c.creadoEn,
      decididoEn: c.decididoEn,
      justificacion: c.estado === 'abierto' ? null : c.justificacion,
      puedeDisputar: c.estado === 'confirmado' && c.origen !== 'disputa' && !disputados.has(c.id),
    }));
  }

  async disputar(id: string, idCandidato: string, explicacion: string): Promise<Caso> {
    const caso = await this.casos.findOne({ where: { id, idCandidato } });
    // 404 y no 403: no se confirma que exista un caso de otra persona.
    if (!caso) throw new NotFoundException('El caso no existe.');
    if (caso.estado !== 'confirmado' || caso.origen === 'disputa') {
      throw new BadRequestException('Solo se disputa una descalificacion confirmada.');
    }
    const disputa = await this.abrir(
      caso.idEvaluacion,
      caso.idVacante,
      caso.idCandidato,
      'disputa',
      {
        idCasoOrigen: caso.id,
        explicacion: explicacion.trim(),
      },
    );
    if (!disputa) throw new ConflictException('Ya disputaste este caso: se disputa una sola vez.');
    return disputa;
  }

  // --- Metricas (C27) ---

  async metricas() {
    const todos = await this.casos.find();
    const decididos = todos.filter((c) => c.estado !== 'abierto');
    const horas = decididos
      .filter((c) => c.decididoEn)
      .map((c) => (c.decididoEn!.getTime() - c.creadoEn.getTime()) / 3_600_000);
    const antifraude = decididos.filter((c) => c.origen === 'antifraude');
    const ahora = Date.now();
    const total = await this.evaluacion.contarEvaluaciones();
    const muestreo = todos.filter((c) => c.origen === 'muestreo').length;
    return {
      casos: {
        total: todos.length,
        abiertos: todos.filter((c) => c.estado === 'abierto').length,
        confirmados: todos.filter((c) => c.estado === 'confirmado').length,
        restaurados: todos.filter((c) => c.estado === 'restaurado').length,
        porOrigen: {
          antifraude: todos.filter((c) => c.origen === 'antifraude').length,
          muestreo,
          disputa: todos.filter((c) => c.origen === 'disputa').length,
        },
      },
      /** De las marcas antifraude ya decididas, cuantas el moderador restauro: el falso positivo observado. */
      tasaDeFalsosPositivos: antifraude.length
        ? antifraude.filter((c) => c.estado === 'restaurado').length / antifraude.length
        : null,
      /** Casos de muestreo sobre el total de evaluaciones: la cobertura del control de calidad. */
      coberturaDelMuestreo: total ? muestreo / total : null,
      horasPromedioDeResolucion: horas.length
        ? horas.reduce((a, b) => a + b, 0) / horas.length
        : null,
      vencidosSinDecidir: todos.filter((c) => c.estado === 'abierto' && c.venceEn.getTime() < ahora)
        .length,
      slaHoras: HORAS_DE_SLA,
    };
  }

  // --- Gestion ---

  crearModerador(datos: { correo: string; contrasena: string; nombreCompleto: string }) {
    return this.autenticacion.crearModerador(datos);
  }

  private async obtener(id: string): Promise<Caso> {
    const caso = await this.casos.findOne({ where: { id } });
    if (!caso) throw new NotFoundException('El caso no existe.');
    return caso;
  }
}
