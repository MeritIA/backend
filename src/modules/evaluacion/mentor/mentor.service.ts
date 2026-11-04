import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsentimientosService, TipoDeConsentimiento } from '../../autenticacion/index.js';
import { EjerciciosService } from '../../ejercicios/index.js';
import type { Solicitante } from '../../vacantes/index.js';
import { EvaluacionService } from '../evaluacion.service.js';
import {
  ClienteServicioIa,
  type PeticionDeMentor,
  type RespuestaDeMentor,
} from '../cola/cliente-servicio-ia.js';
import { ServicioDeIaNoDisponibleError } from '../cola/evaluador.js';
import { construirContexto } from './contexto-del-mentor.js';

const MAX_TURNOS = 6;
/** Preguntas al modelo que pueden estar esperando a la vez, por proceso. */
const MAXIMO_EN_VUELO_POR_OMISION = 10;
/** Cuantas evaluaciones se leen para armar el resumen; el perfil no necesita mas. */
const MAX_EVALUACIONES = 30;

export interface Turno {
  readonly rol: 'candidato' | 'mentor';
  readonly texto: string;
}

/**
 * Mentor IA del candidato.
 *
 * Solo usa las evaluaciones que el propio candidato ya recibio, a peticion
 * suya, y exige el mismo permiso que gobierna que su trabajo pase por la IA
 * (calificacion por IA): el mentor no recibe nada que el servicio de IA no
 * hubiera visto ya. Si el equipo decide que el mentor merece su propio
 * permiso, ese es el sitio donde pedirlo.
 */
@Injectable()
export class MentorService {
  constructor(
    private readonly evaluaciones: EvaluacionService,
    private readonly ejercicios: EjerciciosService,
    private readonly consentimientos: ConsentimientosService,
    private readonly ia: ClienteServicioIa,
    config: ConfigService,
  ) {
    this.maximoEnVuelo =
      Number(config.get<number>('MENTOR_MAXIMO_EN_VUELO')) || MAXIMO_EN_VUELO_POR_OMISION;
  }

  private readonly maximoEnVuelo: number;
  private enVuelo = 0;

  /** Lo que el mentor sabe de la persona. Se muestra tal cual en la pantalla. */
  async contexto(solicitante: Solicitante): Promise<PeticionDeMentor['contexto']> {
    const propias = (await this.evaluaciones.mias(solicitante))
      .filter((e) => !e.descalificada)
      .slice(0, MAX_EVALUACIONES);

    // Solo se busca el titulo de las que se van a mostrar como recientes.
    const titulos = new Map<string, string>();
    await Promise.all(
      propias.slice(0, 3).map(async (e) => {
        const v = await this.ejercicios.versionPorId(e.idVersion);
        if (v) titulos.set(e.id, v.titulo);
      }),
    );

    return construirContexto(
      propias.map((e) => ({
        notaFinal: e.notaFinal,
        titulo: titulos.get(e.id) ?? null,
        criterios: e.criterios,
      })),
    );
  }

  async preguntar(
    pregunta: string,
    historial: readonly Turno[],
    solicitante: Solicitante,
  ): Promise<RespuestaDeMentor> {
    if (
      !(await this.consentimientos.autoriza(solicitante.id, TipoDeConsentimiento.CalificacionIA))
    ) {
      throw new ForbiddenException(
        'Revocaste el permiso de calificacion por IA, y el mentor trabaja con esos mismos datos. ' +
          'Puedes volver a concederlo en Mi perfil > Privacidad.',
      );
    }
    const contexto = await this.contexto(solicitante);
    if (contexto.totalEvaluaciones === 0) {
      return {
        respuesta:
          'Todavia no tienes evaluaciones, asi que no tengo con que aconsejarte. Entrega un reto y vuelve.',
        sugerencias: [],
      };
    }
    // Cada pregunta espera al modelo durante segundos y, mientras espera, ocupa
    // un cupo del control de admision de TODO el backend. Medido con k6: sin
    // este tope, 150 preguntas por segundo dejaban al 55 % del trafico normal
    // con 503. Aqui se rechaza rapido y el mentor no puede agotar los cupos.
    if (this.enVuelo >= this.maximoEnVuelo) {
      throw new HttpException(
        'El mentor esta atendiendo a mucha gente. Intenta de nuevo en unos segundos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.enVuelo += 1;
    try {
      return await this.ia.preguntarAlMentor({
        contexto,
        historial: historial.slice(-MAX_TURNOS),
        pregunta,
      });
    } catch (e) {
      if (e instanceof ServicioDeIaNoDisponibleError) {
        throw new ServiceUnavailableException(
          'El mentor no esta disponible ahora. Intenta de nuevo.',
        );
      }
      throw e;
    } finally {
      this.enVuelo -= 1;
    }
  }
}
