import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  rankingDeCandidatos,
  resumenDeVacante,
  type EvaluacionParaReporte,
  type FilaDeRanking,
  type ResumenDeVacante,
} from './dominio/consolidar.js';
import { aCsv, type Columna } from './dominio/csv.js';
import { AutenticacionService, type Identidad } from '../autenticacion/index.js';
import { EntregasService, EstadoEntrega } from '../entregas/index.js';
import { EvaluacionService } from '../evaluacion/index.js';
import { VacantesService, type Solicitante } from '../vacantes/index.js';

/**
 * Servicio de aplicacion del modulo de reportes (paquete 5.1).
 *
 * Es la unica via por la que otro modulo puede interactuar con reportes.
 *
 * ESTE MODULO NO ES DUENO DE NINGUN DATO
 *
 * No tiene entidades, ni repositorios, ni migracion: compone lo que ya existe
 * en evaluacion, entregas, vacantes y autenticacion, cada uno por su puerta
 * publica.
 *
 * El Diccionario de la EDT lista "esquema de reportes" entre los recursos del
 * paquete, asi que esto es una divergencia con el documento, y queda dicha en
 * voz alta en vez de resuelta en silencio. El motivo: una tabla propia seria
 * una copia de las notas, y una copia se desincroniza —un evento perdido, un
 * reinicio a medias— y entonces el reporte contradice a la evaluacion, que es
 * el dato que se puede disputar. Para el MVP no hace falta: el ranking de una
 * vacante son decenas de filas, no millones. Si el piloto pide analitica que no
 * aguante esta via, el paso natural es proyectar por el evento
 * `evaluacion.evaluacion-finalizada`, que el paquete 4.5 ya publica para esto.
 *
 * EL AISLAMIENTO NO SE REIMPLEMENTA AQUI
 *
 * El tercer criterio del paquete —"ningun reporte muestra datos de una empresa
 * distinta a la del reclutador autenticado"— se cumple delegando: toda lectura
 * entra por `obtenerPara` o `deVacante`, que ya exigen el acceso y responden
 * 404. Comprobarlo otra vez aqui crearia un segundo sitio donde la regla puede
 * quedarse vieja.
 */
@Injectable()
export class ReportesService {
  private readonly logger = new Logger('Reportes');

  constructor(
    private readonly evaluacion: EvaluacionService,
    private readonly entregas: EntregasService,
    private readonly vacantes: VacantesService,
    private readonly autenticacion: AutenticacionService,
  ) {}

  /** Ranking de una vacante con sus cifras consolidadas. */
  async deVacante(idVacante: string, solicitante: Solicitante): Promise<ReporteDeVacante> {
    // La vacante primero: si no es de su empresa, aqui se corta con un 404 y no
    // se llega a tocar ninguna nota.
    const vacante = await this.vacantes.obtenerPara(idVacante, solicitante);

    const [evaluaciones, conteos] = await Promise.all([
      this.evaluacion.deVacante(idVacante, solicitante),
      this.entregas.conteosPorEstado(idVacante, solicitante),
    ]);

    const paraReporte = evaluaciones.map(aFormaDeReporte);
    const ranking = rankingDeCandidatos(paraReporte);
    const resumen = resumenDeVacante(ranking, paraReporte, {
      enProceso: conteos[EstadoEntrega.Recibida] + conteos[EstadoEntrega.EnEvaluacion],
      fallidas: conteos[EstadoEntrega.Fallida],
    });

    const identidades = await this.autenticacion.identidadesDe(ranking.map((f) => f.idCandidato));

    this.registrar('reporte_de_vacante_consultado', solicitante, {
      idVacante,
      candidatos: ranking.length,
    });

    return {
      vacante: cabecera(vacante),
      resumen,
      ranking: ranking.map((fila) => ({
        ...fila,
        candidato: identificar(identidades, fila.idCandidato),
      })),
      generadoEn: new Date(),
    };
  }

  /**
   * El detalle de un candidato en una vacante: todos sus intentos evaluados,
   * con el desglose por criterio y la evidencia de cada puntaje.
   *
   * Va DENTRO de la vacante a proposito. Un reporte "del candidato" sin vacante
   * mostraria su historial en otras empresas, y eso es justo lo que prohibe el
   * tercer criterio del paquete.
   */
  async deCandidatoEnVacante(
    idVacante: string,
    idCandidato: string,
    solicitante: Solicitante,
  ): Promise<ReporteDeCandidato> {
    const vacante = await this.vacantes.obtenerPara(idVacante, solicitante);
    const todas = (await this.evaluacion.deVacante(idVacante, solicitante)).map(aFormaDeReporte);
    const suyas = todas.filter((e) => e.idCandidato === idCandidato);

    if (suyas.length === 0) {
      // Mismo 404 que si la vacante no fuera suya: quien pregunta no averigua
      // si ese identificador es de un candidato que existe.
      throw new NotFoundException('Ese candidato no tiene evaluaciones en esta vacante.');
    }

    const identidades = await this.autenticacion.identidadesDe([idCandidato]);
    const posicion =
      rankingDeCandidatos(todas).find((f) => f.idCandidato === idCandidato)?.posicion ?? null;

    this.registrar('reporte_de_candidato_consultado', solicitante, { idVacante, idCandidato });

    return {
      vacante: cabecera(vacante),
      candidato: identificar(identidades, idCandidato),
      idCandidato,
      posicionEnLaVacante: posicion,
      // Del intento mas reciente al mas viejo: es como se lee un historial.
      intentos: [...suyas].sort((a, b) => b.creadaEn.getTime() - a.creadaEn.getTime()),
      generadoEn: new Date(),
    };
  }

  /**
   * El ranking en CSV (entregable "exportacion basica del reporte").
   *
   * Una fila por candidato y no una por criterio: es la tabla que el reclutador
   * quiere pegar en un correo o en su hoja de seguimiento. El desglose completo
   * vive en el detalle por candidato, que es donde se mira una nota concreta.
   */
  async csvDeVacante(
    idVacante: string,
    solicitante: Solicitante,
  ): Promise<{ nombre: string; contenido: string }> {
    const reporte = await this.deVacante(idVacante, solicitante);

    const columnas: Columna<FilaConCandidato>[] = [
      { titulo: 'Posicion', valor: (f) => f.posicion },
      { titulo: 'Candidato', valor: (f) => f.candidato.nombre },
      { titulo: 'Correo', valor: (f) => f.candidato.correo },
      { titulo: 'Nota final', valor: (f) => f.notaFinal },
      { titulo: 'Intentos evaluados', valor: (f) => f.intentosEvaluados },
      { titulo: 'Evaluada en', valor: (f) => f.evaluadaEn },
      { titulo: 'Riesgo de inyeccion', valor: (f) => f.riesgoInyeccion },
      { titulo: 'Id de entrega', valor: (f) => f.idEntrega },
    ];

    return {
      nombre: `reporte-${nombreDeArchivo(reporte.vacante.titulo)}.csv`,
      contenido: aCsv(reporte.ranking, columnas),
    };
  }

  private registrar(
    evento: string,
    solicitante: Solicitante,
    metadata: Record<string, unknown>,
  ): void {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        eventType: evento,
        userId: solicitante.id,
        metadata,
      }),
    );
  }
}

const cabecera = (v: { id: string; titulo: string; estado: string }): CabeceraDeVacante => ({
  id: v.id,
  titulo: v.titulo,
  estado: v.estado,
});

/** Nombre y correo, o un marcador si la cuenta ya no existe. */
function identificar(identidades: Map<string, Identidad>, id: string): Identidad {
  // Una cuenta borrada no debe tumbar el reporte: la nota sigue siendo valida y
  // el reclutador tiene que poder ver que esa fila existio.
  return identidades.get(id) ?? { nombre: 'Candidato no disponible', correo: '' };
}

/** Un titulo de vacante no decide el nombre de un archivo. */
function nombreDeArchivo(titulo: string): string {
  const limpio = titulo
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return limpio || 'vacante';
}

/** La forma en la que llega una evaluacion por la puerta de su modulo. */
interface EvaluacionLeida {
  id: string;
  idEntrega: string;
  idCandidato: string;
  idEjercicio: string;
  notaFinal: number;
  creadaEn: Date;
  riesgoInyeccion: string;
  criterios?: {
    criterio: string;
    puntaje: number;
    escalaMaxima: number;
    peso: number;
    evidencia: string;
  }[];
}

function aFormaDeReporte(e: EvaluacionLeida): EvaluacionParaReporte {
  return {
    idEvaluacion: e.id,
    idEntrega: e.idEntrega,
    idCandidato: e.idCandidato,
    idEjercicio: e.idEjercicio,
    notaFinal: e.notaFinal,
    creadaEn: e.creadaEn,
    riesgoInyeccion: e.riesgoInyeccion,
    criterios: e.criterios ?? [],
  };
}

export interface CabeceraDeVacante {
  id: string;
  titulo: string;
  estado: string;
}

export interface FilaConCandidato extends FilaDeRanking {
  candidato: Identidad;
}

export interface ReporteDeVacante {
  vacante: CabeceraDeVacante;
  resumen: ResumenDeVacante;
  ranking: FilaConCandidato[];
  generadoEn: Date;
}

export interface ReporteDeCandidato {
  vacante: CabeceraDeVacante;
  candidato: Identidad;
  idCandidato: string;
  posicionEnLaVacante: number | null;
  intentos: EvaluacionParaReporte[];
  generadoEn: Date;
}
