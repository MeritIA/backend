import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sesion } from './entities/sesion.entity.js';
import { EjerciciosService } from '../ejercicios/index.js';
import { VacantesService, type Solicitante } from '../vacantes/index.js';

/**
 * Margen para terminar de SUBIR un archivo que se empezo a subir a tiempo. El
 * plazo es para resolver, no para tener buena conexion: sin esto, 25 MiB que
 * empezaron a subirse en el ultimo segundo se rechazarian por la red.
 */
export const GRACIA_DE_SUBIDA_MS = 60_000;

export interface EstadoDeSesion {
  /** Null si el ejercicio no tiene limite de tiempo. */
  duracionMinutos: number | null;
  iniciadaEn: Date | null;
  venceEn: Date | null;
  /** Segundos que le quedan segun el reloj del SERVIDOR; 0 si ya vencio. */
  restanteSegundos: number | null;
}

/**
 * Sesion cronometrada de un ejercicio (B17).
 *
 * El reloj es el del servidor: el navegador pinta la cuenta atras con
 * `restanteSegundos`, pero lo que decide si una entrega entra es `venceEn`.
 * Iniciar dos veces no reinicia nada: devuelve la misma sesion.
 */
@Injectable()
export class SesionesService {
  constructor(
    @InjectRepository(Sesion) private readonly sesiones: Repository<Sesion>,
    private readonly ejercicios: EjerciciosService,
    private readonly vacantes: VacantesService,
  ) {}

  async estado(
    idVacante: string,
    idEjercicio: string,
    solicitante: Solicitante,
  ): Promise<EstadoDeSesion> {
    await this.exigirAcceso(idVacante, idEjercicio, solicitante);
    const sesion = await this.sesiones.findOne({
      where: { idVacante, idCandidato: solicitante.id, idEjercicio },
    });
    if (sesion) return this.aEstado(sesion);
    const vigente = await this.ejercicios.versionVigenteDe(idEjercicio);
    return {
      duracionMinutos: vigente?.duracionMinutos ?? null,
      iniciadaEn: null,
      venceEn: null,
      restanteSegundos: null,
    };
  }

  async iniciar(
    idVacante: string,
    idEjercicio: string,
    solicitante: Solicitante,
  ): Promise<EstadoDeSesion> {
    await this.exigirAcceso(idVacante, idEjercicio, solicitante);
    const existente = await this.sesiones.findOne({
      where: { idVacante, idCandidato: solicitante.id, idEjercicio },
    });
    if (existente) return this.aEstado(existente);

    const vigente = await this.ejercicios.versionVigenteDe(idEjercicio);
    if (!vigente?.duracionMinutos) {
      throw new BadRequestException(
        'Este ejercicio no tiene limite de tiempo: no hay que iniciarlo.',
      );
    }
    const ahora = new Date();
    try {
      const nueva = await this.sesiones.save(
        this.sesiones.create({
          idVacante,
          idCandidato: solicitante.id,
          idEjercicio,
          duracionMinutos: vigente.duracionMinutos,
          iniciadaEn: ahora,
          venceEn: new Date(ahora.getTime() + vigente.duracionMinutos * 60_000),
        }),
      );
      return this.aEstado(nueva);
    } catch {
      // Dos pulsaciones a la vez: gana la primera, la segunda recibe la misma sesion.
      const ganadora = await this.sesiones.findOneOrFail({
        where: { idVacante, idCandidato: solicitante.id, idEjercicio },
      });
      return this.aEstado(ganadora);
    }
  }

  /**
   * La regla que aplica `entregar`: un ejercicio con limite exige sesion
   * iniciada y vigente. Lanza 403 con el motivo; no devuelve nada si todo bien.
   */
  async exigirVigente(idVacante: string, idEjercicio: string, idCandidato: string): Promise<void> {
    const sesion = await this.sesiones.findOne({ where: { idVacante, idCandidato, idEjercicio } });
    if (sesion) {
      if (Date.now() > sesion.venceEn.getTime() + GRACIA_DE_SUBIDA_MS) {
        throw new ForbiddenException(
          'Se acabo el tiempo de este ejercicio: ya no se aceptan entregas.',
        );
      }
      return;
    }
    const vigente = await this.ejercicios.versionVigenteDe(idEjercicio);
    if (vigente?.duracionMinutos) {
      throw new ForbiddenException(
        `Este ejercicio tiene ${vigente.duracionMinutos} minutos: inicialo antes de entregar.`,
      );
    }
  }

  private async exigirAcceso(
    idVacante: string,
    idEjercicio: string,
    solicitante: Solicitante,
  ): Promise<void> {
    if (!(await this.vacantes.puedeRecibirEntrega(idVacante, solicitante.id))) {
      throw new NotFoundException('La vacante no existe o no acepta entregas.');
    }
    const ids = await this.vacantes.idsDeEjerciciosDe(idVacante);
    if (!ids.includes(idEjercicio)) {
      throw new BadRequestException('El ejercicio no pertenece a esta vacante.');
    }
  }

  private aEstado(s: Sesion): EstadoDeSesion {
    return {
      duracionMinutos: s.duracionMinutos,
      iniciadaEn: s.iniciadaEn,
      venceEn: s.venceEn,
      restanteSegundos: Math.max(0, Math.round((s.venceEn.getTime() - Date.now()) / 1000)),
    };
  }
}
