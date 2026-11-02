import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Evaluacion } from './entities/evaluacion.entity.js';
import { Rol } from '../autenticacion/index.js';
import { EstadoVacante, VacantesService, type Solicitante } from '../vacantes/index.js';
import { HabilidadesService } from '../ejercicios/index.js';
import type { NivelDeHabilidad } from './dominio/habilidad.js';

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
    // El vocabulario de habilidades, para que el perfil agrupe sinonimos.
    private readonly habilidades: HabilidadesService,
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
  /**
   * El perfil de habilidades de un candidato: su nivel en cada criterio sobre
   * el que alguna vez se le califico.
   *
   * ES EL DATO QUE FALTABA PARA EL % DE AFINIDAD
   *
   * B13 lo promete y la matriz lo tenia marcado como inexistente: "hoy los
   * criterios viven dentro de cada ejercicio". Viven, si, pero las
   * CALIFICACIONES no: `calificaciones_criterio` guarda una fila por criterio
   * con su puntaje y su escala. Agrupando por nombre de criterio sale un perfil
   * transversal sin inventar ninguna taxonomia.
   *
   * SE AGREGA EN LA BASE Y NO EN MEMORIA
   *
   * Un candidato con veinte evaluaciones de cinco criterios son cien filas para
   * calcular cinco medias. Traerlas para promediarlas en Node seria pedirle a
   * PostgreSQL justo lo que no sabe hacer peor.
   *
   * EL NIVEL ES puntaje/escala, NO el puntaje
   *
   * Un 4 sobre 5 y un 8 sobre 10 son el mismo nivel. Comparar puntajes de
   * escalas distintas es el error que haria que un ejercicio con escala 10
   * pesara el doble sin que nadie lo decidiera.
   *
   * SIN FILTRO POR EMPRESA, Y A PROPOSITO
   *
   * El perfil es de la persona y atraviesa las empresas para las que hizo
   * pruebas: es justo lo que lo hace transversal. No se expone a ninguna
   * empresa --solo al propio candidato, y agregado-- asi que no filtra nada de
   * un proceso ajeno: un nivel medio no dice en que vacante se obtuvo.
   */
  async perfilDeHabilidades(idCandidato: string): Promise<Map<string, NivelDeHabilidad>> {
    const filas = await this.evaluaciones
      .createQueryBuilder('e')
      .innerJoin('e.criterios', 'c')
      .select('c.criterio', 'criterio')
      // El nivel medio, ya normalizado por la escala de cada criterio.
      .addSelect('avg(c.puntaje / c.escala_maxima)', 'nivel')
      .addSelect('count(*)', 'veces')
      .where('e.id_candidato = :idCandidato', { idCandidato })
      // Una escala cero reventaria la division. No deberia existir --la rubrica
      // la valida-- pero el agregado no es el sitio donde descubrirlo.
      .andWhere('c.escala_maxima > 0')
      .groupBy('c.criterio')
      .getRawMany<{ criterio: string; nivel: string; veces: string }>();

    // El vocabulario traduce los sinonimos: "Legibilidad" y "Claridad del
    // codigo" acaban en la MISMA habilidad. Sin esto, el perfil tendria dos
    // entradas a medias donde deberia tener una entera.
    const traducir = await this.habilidades.traductorPara(filas.map((f) => f.criterio));

    const perfil = new Map<string, NivelDeHabilidad>();
    for (const fila of filas) {
      const clave = traducir(fila.criterio);
      const nivel = Number(fila.nivel);
      const veces = Number(fila.veces);
      // Dos nombres distintos pueden normalizar a la misma clave ("Correccion
      // funcional" y "corrección funcional"): se funden ponderando por veces,
      // que es lo que habria salido si se hubieran escrito igual.
      const previo = perfil.get(clave);
      if (previo) {
        const total = previo.veces + veces;
        perfil.set(clave, {
          nombre: previo.nombre,
          nivel: (previo.nivel * previo.veces + nivel * veces) / total,
          veces: total,
        });
      } else {
        perfil.set(clave, { nombre: fila.criterio, nivel, veces });
      }
    }
    return perfil;
  }

  async candidatosConEvaluacionEn(idVacante: string): Promise<string[]> {
    const filas = await this.evaluaciones
      .createQueryBuilder('e')
      .select('distinct e.idCandidato', 'idCandidato')
      .where('e.idVacante = :idVacante', { idVacante })
      .getRawMany<{ idCandidato: string }>();
    return filas.map((f) => f.idCandidato);
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
