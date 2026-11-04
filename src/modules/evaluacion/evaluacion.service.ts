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
      where: { idVacante, descalificada: false },
      relations: { criterios: true },
      order: { notaFinal: 'DESC', creadaEn: 'ASC', criterios: { orden: 'ASC' } },
    });
  }

  /** Lo que un moderador necesita para decidir. Sin identidad: el caso lleva alias. */
  async paraRevision(idEvaluacion: string): Promise<{
    idEvaluacion: string;
    idEntrega: string;
    idVacante: string;
    idCandidato: string;
    notaFinal: number;
    riesgo: string;
    puntajeInyeccion: number;
    banderas: { codigo: string; archivo: string; ocurrencias: number }[];
    descalificada: boolean;
    criterios: { criterio: string; puntaje: number; escalaMaxima: number; evidencia: string }[];
  } | null> {
    const e = await this.evaluaciones.findOne({
      where: { id: idEvaluacion },
      relations: { criterios: true },
      order: { criterios: { orden: 'ASC' } },
    });
    if (!e) return null;
    return {
      idEvaluacion: e.id,
      idEntrega: e.idEntrega,
      idVacante: e.idVacante,
      idCandidato: e.idCandidato,
      notaFinal: e.notaFinal,
      riesgo: e.riesgoInyeccion,
      puntajeInyeccion: e.puntajeInyeccion,
      banderas: e.banderas,
      descalificada: e.descalificada,
      criterios: e.criterios.map((c) => ({
        criterio: c.criterio,
        puntaje: c.puntaje,
        escalaMaxima: c.escalaMaxima,
        evidencia: c.evidencia,
      })),
    };
  }

  /**
   * Integridad de una vacante, contando TAMBIEN las descalificadas: es lo que la
   * auditoria necesita ver y el ranking no. Alcance ya comprobado por quien llama.
   */
  async integridadDeVacante(idVacante: string): Promise<{
    evaluaciones: number;
    descalificadas: number;
    riesgoAlto: number;
    riesgoMedio: number;
  }> {
    const [fila] = await this.evaluaciones
      .createQueryBuilder('e')
      .select('count(*)::int', 'evaluaciones')
      .addSelect('count(*) filter (where e.descalificada)::int', 'descalificadas')
      .addSelect("count(*) filter (where e.riesgo_inyeccion = 'alto')::int", 'riesgoAlto')
      .addSelect("count(*) filter (where e.riesgo_inyeccion = 'medio')::int", 'riesgoMedio')
      .where('e.id_vacante = :idVacante', { idVacante })
      .getRawMany<{
        evaluaciones: number;
        descalificadas: number;
        riesgoAlto: number;
        riesgoMedio: number;
      }>();
    return {
      evaluaciones: Number(fila.evaluaciones),
      descalificadas: Number(fila.descalificadas),
      riesgoAlto: Number(fila.riesgoAlto),
      riesgoMedio: Number(fila.riesgoMedio),
    };
  }

  /** Solo la llama moderacion, al decidir un caso. */
  async marcarDescalificada(idEvaluacion: string, descalificada: boolean): Promise<void> {
    await this.evaluaciones.update({ id: idEvaluacion }, { descalificada });
  }

  async contarEvaluaciones(): Promise<number> {
    return this.evaluaciones.count();
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

  // --- Consultas que otros modulos pueden necesitar, por esta puerta ---

  /**
   * Quienes tienen al menos una entrega evaluada en la vacante.
   *
   * La usa el modulo de notificaciones para saber a quien avisar del cierre.
   * Devuelve identificadores y nada mas: ni notas ni puestos, que no le hacen
   * falta a quien solo tiene que escribir un correo.
   *
   * `distinct` porque un candidato puede tener varios intentos evaluados y el
   * aviso es uno por persona, no uno por intento. Esa diferencia es la que
   * convierte un correo en tres.
   *
   * No lleva comprobacion de acceso: no recibe nada de una peticion de usuario
   * —la vacante la pone un evento de dominio o un endpoint que ya comprobo la
   * propiedad— y lo que devuelve no identifica a nadie por si solo.
   */
  async candidatosConEvaluacionEn(idVacante: string): Promise<string[]> {
    const filas = await this.evaluaciones
      .createQueryBuilder('e')
      .select('distinct e.idCandidato', 'idCandidato')
      .where('e.idVacante = :idVacante', { idVacante })
      .getRawMany<{ idCandidato: string }>();
    return filas.map((f) => f.idCandidato);
  }

  /** Evaluaciones y nota promedio de cada ejercicio, solo de la empresa que pregunta. */
  async estadisticasPorEjercicio(
    idEmpresa: string,
  ): Promise<Record<string, { evaluaciones: number; notaPromedio: number }>> {
    const filas = await this.evaluaciones
      .createQueryBuilder('e')
      .select('e.id_ejercicio', 'idEjercicio')
      .addSelect('count(*)::int', 'evaluaciones')
      .addSelect('round(avg(e.nota_final), 1)::float', 'notaPromedio')
      .where('e.id_empresa = :idEmpresa', { idEmpresa })
      .groupBy('e.id_ejercicio')
      .getRawMany<{ idEjercicio: string; evaluaciones: number; notaPromedio: number }>();
    return Object.fromEntries(
      filas.map((f) => [
        f.idEjercicio,
        { evaluaciones: Number(f.evaluaciones), notaPromedio: Number(f.notaPromedio) },
      ]),
    );
  }

  /**
   * La mejor nota y cuantas evaluaciones tiene cada persona, en cualquier
   * vacante. Para quien YA autorizo mostrar su perfil: el que llama filtra por
   * consentimiento antes de preguntar.
   */
  async resumenPorCandidato(
    idsDeCandidatos: readonly string[],
  ): Promise<{ idCandidato: string; mejorNota: number; evaluaciones: number }[]> {
    if (idsDeCandidatos.length === 0) return [];
    const filas = await this.evaluaciones
      .createQueryBuilder('e')
      .select('e.id_candidato', 'idCandidato')
      .addSelect('max(e.nota_final)::float', 'mejorNota')
      .addSelect('count(*)::int', 'evaluaciones')
      .where('e.id_candidato IN (:...idsDeCandidatos)', { idsDeCandidatos })
      .andWhere('e.descalificada = false')
      .groupBy('e.id_candidato')
      .getRawMany<{ idCandidato: string; mejorNota: number; evaluaciones: number }>();
    return filas.map((f) => ({
      idCandidato: f.idCandidato,
      mejorNota: Number(f.mejorNota),
      evaluaciones: Number(f.evaluaciones),
    }));
  }

  /**
   * Cuantas PERSONAS distintas ya tienen evaluacion, vacante por vacante.
   *
   * Es la otra mitad del "avance" de A02: lo que de verdad esta resuelto. Va en
   * lote porque el panel muestra todas las vacantes abiertas de la empresa y
   * una llamada por vacante es justo lo que esa pantalla no se puede permitir.
   *
   * `distinct id_candidato` por la misma razon que en el aviso de cierre: quien
   * reintento tiene dos evaluaciones y sigue siendo una persona avanzada.
   *
   * No recibe nada de una peticion: la lista de vacantes la arma el panel con
   * la empresa del token. No hay identificador que un atacante pueda cambiar.
   */
  async candidatosEvaluadosPorVacante(
    idsDeVacantes: readonly string[],
  ): Promise<Record<string, number>> {
    if (idsDeVacantes.length === 0) return {};

    const filas = await this.evaluaciones
      .createQueryBuilder('e')
      .select('e.id_vacante', 'idVacante')
      .addSelect('count(distinct e.id_candidato)::int', 'total')
      .where('e.id_vacante IN (:...idsDeVacantes)', { idsDeVacantes })
      .groupBy('e.id_vacante')
      .getRawMany<{ idVacante: string; total: number }>();

    return Object.fromEntries(filas.map((f) => [f.idVacante, Number(f.total)]));
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
