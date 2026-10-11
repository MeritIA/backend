import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Evaluacion } from './entities/evaluacion.entity.js';
import { Rol } from '../autenticacion/index.js';
import { VacantesService, type Solicitante } from '../vacantes/index.js';

/**
 * Servicio de aplicacion del modulo de evaluacion.
 *
 * Es la puerta de lectura: quien quiera una nota pasa por aqui, nadie importa
 * sus entidades. La escritura la hace el evaluador de la cola, que es el unico
 * camino por el que se crea una evaluacion.
 *
 * QUIEN VE QUE
 *
 * - El candidato, las suyas.
 * - El reclutador o administrador de la empresa dueña de la vacante.
 * - Nadie mas, y a quien lo intente se le responde 404: un 403 confirmaria que
 *   la evaluacion existe.
 */
@Injectable()
export class EvaluacionService {
  private readonly logger = new Logger('Evaluacion');

  constructor(
    @InjectRepository(Evaluacion) private readonly evaluaciones: Repository<Evaluacion>,
    private readonly vacantes: VacantesService,
  ) {}

  /** La evaluacion de una entrega, con su desglose por criterio. */
  async deEntrega(idEntrega: string, solicitante: Solicitante): Promise<Evaluacion> {
    const evaluacion = await this.evaluaciones.findOne({
      where: { idEntrega },
      relations: { criterios: true },
      order: { criterios: { orden: 'ASC' } },
    });
    if (!evaluacion) throw new NotFoundException('Esa entrega todavia no tiene evaluacion.');

    await this.exigirAcceso(evaluacion, solicitante);
    return evaluacion;
  }

  /** Las evaluaciones de una vacante, para su empresa. Base del reporte (5.1). */
  async deVacante(idVacante: string, solicitante: Solicitante): Promise<Evaluacion[]> {
    if (!(await this.vacantes.puedeVerEntregasDe(idVacante, solicitante))) {
      this.registrar('acceso_denegado_por_recurso', solicitante, { idVacante });
      throw new NotFoundException('La vacante no existe.');
    }
    return this.evaluaciones.find({
      where: { idVacante },
      relations: { criterios: true },
      order: { notaFinal: 'DESC', creadaEn: 'ASC', criterios: { orden: 'ASC' } },
    });
  }

  /** Las del propio candidato. */
  async mias(solicitante: Solicitante): Promise<Evaluacion[]> {
    return this.evaluaciones.find({
      where: { idCandidato: solicitante.id },
      relations: { criterios: true },
      order: { creadaEn: 'DESC', criterios: { orden: 'ASC' } },
    });
  }

  private async exigirAcceso(evaluacion: Evaluacion, solicitante: Solicitante): Promise<void> {
    if (solicitante.rol === Rol.Candidato) {
      if (evaluacion.idCandidato === solicitante.id) return;
    } else if (await this.vacantes.puedeVerEntregasDe(evaluacion.idVacante, solicitante)) {
      return;
    }

    this.registrar('acceso_denegado_por_recurso', solicitante, { idEvaluacion: evaluacion.id });
    throw new NotFoundException('Esa entrega todavia no tiene evaluacion.');
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
