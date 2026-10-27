import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Evaluacion } from './entities/evaluacion.entity.js';
import { Rol } from '../autenticacion/index.js';
import { EstadoVacante, VacantesService, type Solicitante } from '../vacantes/index.js';

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

  /**
   * El puesto del propio candidato en la vacante.
   *
   * SOLO CUANDO LA VACANTE YA ESTA CERRADA, y la decision no es timida.
   *
   * La pantalla B22 le muestra al candidato su posicion. Mientras el proceso
   * esta abierto, esa posicion cambia sin que el candidato haga nada —cada vez
   * que otro entrega—, asi que no es informacion suya: es un canal lateral
   * sobre la actividad de los demas. Alguien que consulte cada hora puede
   * deducir cuando entrega la competencia y cuantos van. Con la vacante cerrada
   * el numero es un hecho final y auditable, y es lo que convierte la promesa
   * meritocratica en algo que el candidato puede verificar: sin puesto, un 72
   * sobre 100 no se puede interpretar.
   *
   * Queda como decision abierta en la Declaracion de Alcance: si el equipo
   * prefiere mostrarlo en vivo, se cambia una condicion.
   *
   * COMO SE CALCULA, Y POR QUE ASI
   *
   * Puesto = cuantos candidatos tienen mejor nota que la mia, mas uno. Eso da
   * exactamente el mismo numero que el ranking del modulo de reportes
   * —empatados comparten puesto, y el siguiente salta— sin traer ni una fila
   * de otro candidato a memoria, y sin que este modulo dependa de reportes,
   * que depende de el. Hay una prueba de integracion que compara los dos
   * numeros contra los mismos datos, para que no se separen en silencio.
   *
   * `MAX(nota_final)` es la regla D-1: puntua el mejor intento.
   */
  async miPuestoEn(idVacante: string, solicitante: Solicitante): Promise<MiPuesto> {
    // 404 si no fue invitado, o si la vacante sigue en borrador.
    const vacante = await this.vacantes.obtenerPara(idVacante, solicitante);
    const cabecera = { idVacante, estadoVacante: vacante.estado };

    if (vacante.estado !== EstadoVacante.Cerrada) {
      // 200 y no 403: la pregunta es legitima y la respuesta es "todavia no".
      // Un 403 le diria que nunca podra verlo, y la pantalla tiene que poder
      // dibujar este estado.
      return {
        ...cabecera,
        disponible: false,
        motivo: 'proceso_en_curso',
        puesto: null,
        total: null,
        notaFinal: null,
      };
    }

    const mejores = await this.evaluaciones
      .createQueryBuilder('e')
      .select('e.idCandidato', 'idCandidato')
      .addSelect('MAX(e.notaFinal)', 'nota')
      .where('e.idVacante = :idVacante', { idVacante })
      .groupBy('e.idCandidato')
      .getRawMany<{ idCandidato: string; nota: string }>();

    const mia = mejores.find((m) => m.idCandidato === solicitante.id);
    if (!mia) {
      // Invitado pero sin ninguna entrega evaluada. No es un error: es el
      // candidato que no participo, y decirselo asi no revela nada de nadie.
      return {
        ...cabecera,
        disponible: false,
        motivo: 'sin_evaluacion',
        puesto: null,
        total: null,
        notaFinal: null,
      };
    }

    // `MAX` de una columna numeric vuelve como cadena en PostgreSQL.
    const notaFinal = Number(mia.nota);
    const mejoresQueLaMia = mejores.filter((m) => Number(m.nota) > notaFinal).length;

    return {
      ...cabecera,
      disponible: true,
      puesto: mejoresQueLaMia + 1,
      total: mejores.length,
      notaFinal,
    };
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

/**
 * Lo que el candidato puede saber de su posicion.
 *
 * `total` dice cuanta gente participo, y eso solo sale con el proceso cerrado:
 * es el dato que hace interpretable el puesto, y con la vacante abierta seria
 * informacion sobre terceros.
 */
export interface MiPuesto {
  idVacante: string;
  estadoVacante: EstadoVacante;
  disponible: boolean;
  motivo?: 'proceso_en_curso' | 'sin_evaluacion';
  /** Empieza en 1. Empatados comparten puesto. */
  puesto: number | null;
  /** Candidatos con al menos una entrega evaluada en la vacante. */
  total: number | null;
  notaFinal: number | null;
}
