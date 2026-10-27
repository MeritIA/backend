import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ReporteDeCandidato, ReporteDeVacante } from '../reportes.service.js';

/**
 * Forma de las respuestas del reporte (paquete 5.1).
 *
 * Se declara aparte de lo que devuelve el servicio para que el contrato
 * publicado no cambie solo porque una entidad gane una columna.
 */

/**
 * Identidad de un candidato. SOLO aparece en la respuesta de revelar: nunca en
 * el ranking ni en el detalle, que van con alias.
 */
export class IdentidadReveladaRespuesta {
  @ApiProperty({ example: 'Candidato ••••3f8a2c' }) alias!: string;
  @ApiProperty({ format: 'uuid' }) idCandidato!: string;
  @ApiProperty({ example: 'Ana Maria Rojas' }) nombre!: string;
  @ApiProperty({
    example: 'ana@ejemplo.com',
    description: 'El correo con el que el reclutador la invito. Vacio si la cuenta ya no existe.',
  })
  correo!: string;
  @ApiProperty({ description: 'Queda registrado quien la revelo y cuando.' })
  reveladaEn!: Date;
}

export class RevelacionRegistradaRespuesta {
  @ApiProperty({ example: 'Candidato ••••3f8a2c' }) alias!: string;
  @ApiProperty({ format: 'uuid' }) idCandidato!: string;
  @ApiProperty({ format: 'uuid', description: 'Quien la revelo.' }) idUsuario!: string;
  @ApiProperty() reveladaEn!: Date;
}

export class HabilidadDestacadaRespuesta {
  @ApiProperty({ example: 'Correccion funcional' }) criterio!: string;
  @ApiProperty({ minimum: 0, maximum: 100, example: 92.5 }) porcentajeLogrado!: number;
  @ApiProperty({ minimum: 0, maximum: 100, example: 40 }) peso!: number;
}

export class FilaDeRankingRespuesta {
  @ApiProperty({ minimum: 1, description: 'Dos candidatos empatados comparten posicion.' })
  posicion!: number;

  @ApiProperty({
    example: 'Candidato ••••3f8a2c',
    description:
      'Identidad oculta: el ranking se lee sin nombres para no sesgar la comparacion. Es estable dentro de la vacante y distinto en otras. El nombre se obtiene revelando, y queda registrado.',
  })
  alias!: string;

  @ApiProperty({ format: 'uuid' }) idCandidato!: string;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'La del mejor intento evaluado. El detalle del candidato muestra todos.',
  })
  notaFinal!: number;

  @ApiProperty({ minimum: 1 }) intentosEvaluados!: number;
  @ApiProperty({ format: 'uuid' }) idEntrega!: string;
  @ApiProperty({ format: 'uuid' }) idEvaluacion!: string;
  @ApiProperty() evaluadaEn!: Date;

  @ApiProperty({
    enum: ['ninguno', 'bajo', 'medio', 'alto'],
    description: 'Del intento que puntua. Riesgo alto: conviene revisar la entrega a mano.',
  })
  riesgoInyeccion!: string;

  @ApiProperty({
    type: HabilidadDestacadaRespuesta,
    nullable: true,
    description:
      'El criterio en el que mejor le fue, del MISMO intento que da la nota. Es lo que distingue a dos personas con notas parecidas. Nulo si esa evaluacion no trae desglose.',
  })
  habilidadDestacada!: HabilidadDestacadaRespuesta | null;
}

export class PromedioDeCriterioRespuesta {
  @ApiProperty() criterio!: string;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description:
      'Promedio del porcentaje logrado en ese criterio. En porcentaje y no en puntos crudos, porque dos criterios con escalas distintas no se comparan en bruto.',
  })
  promedioLogrado!: number;

  @ApiProperty({ description: 'Cuanto aporta el criterio a la nota final.' }) peso!: number;
  @ApiProperty({ description: 'Sobre cuantas evaluaciones se calculo.' }) evaluaciones!: number;
}

export class ResumenRespuesta {
  @ApiProperty({ description: 'Cuantas personas distintas tienen al menos una nota.' })
  candidatosEvaluados!: number;

  @ApiProperty() entregasEvaluadas!: number;

  @ApiProperty({
    description: 'Recibidas o evaluandose. Dice si el ranking todavia esta incompleto.',
  })
  entregasEnProceso!: number;

  @ApiProperty({ description: 'Fallo la evaluacion, no el candidato. Se pueden reintentar.' })
  entregasFallidas!: number;

  @ApiProperty({
    nullable: true,
    description: 'Una nota por candidato: quien entrego cinco veces no pesa cinco veces.',
  })
  notaPromedio!: number | null;

  @ApiProperty({ nullable: true }) notaMediana!: number | null;
  @ApiProperty({ nullable: true }) notaMaxima!: number | null;
  @ApiProperty({ nullable: true }) notaMinima!: number | null;

  @ApiProperty({
    type: [PromedioDeCriterioRespuesta],
    description: 'Del criterio mas flojo al mas logrado: donde se cae la gente.',
  })
  porCriterio!: PromedioDeCriterioRespuesta[];

  @ApiProperty({ description: 'Entregas marcadas con riesgo alto de inyeccion (paquete 4.2).' })
  entregasConRiesgoAlto!: number;
}

export class VacanteDelReporteRespuesta {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() titulo!: string;
  @ApiProperty({ example: 'publicada' }) estado!: string;
}

export class ReporteDeVacanteRespuesta {
  @ApiProperty({ type: VacanteDelReporteRespuesta }) vacante!: VacanteDelReporteRespuesta;
  @ApiProperty({ type: ResumenRespuesta }) resumen!: ResumenRespuesta;

  @ApiProperty({ type: [FilaDeRankingRespuesta], description: 'De mayor a menor nota.' })
  ranking!: FilaDeRankingRespuesta[];

  @ApiProperty({
    description: 'El reporte se calcula al pedirlo; no hay copia que se desactualice.',
  })
  generadoEn!: Date;
}

export class CriterioDelIntentoRespuesta {
  @ApiProperty() criterio!: string;
  @ApiProperty() puntaje!: number;
  @ApiProperty() escalaMaxima!: number;
  @ApiProperty() peso!: number;
  @ApiProperty({ description: 'Por que ese puntaje, con referencia a la entrega.' })
  evidencia!: string;
}

export class IntentoRespuesta {
  @ApiProperty({ format: 'uuid' }) idEvaluacion!: string;
  @ApiProperty({ format: 'uuid' }) idEntrega!: string;
  @ApiProperty({ format: 'uuid' }) idEjercicio!: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) notaFinal!: number;
  @ApiProperty() creadaEn!: Date;
  @ApiProperty({ enum: ['ninguno', 'bajo', 'medio', 'alto'] }) riesgoInyeccion!: string;

  @ApiProperty({ type: [CriterioDelIntentoRespuesta], description: 'En el orden de la rubrica.' })
  criterios!: CriterioDelIntentoRespuesta[];
}

export class ReporteDeCandidatoRespuesta {
  @ApiProperty({ type: VacanteDelReporteRespuesta }) vacante!: VacanteDelReporteRespuesta;
  @ApiProperty({ example: 'Candidato ••••3f8a2c' }) alias!: string;
  @ApiProperty({ format: 'uuid' }) idCandidato!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Su puesto en el ranking de la vacante.' })
  posicionEnLaVacante!: number | null;

  @ApiProperty({ type: [IntentoRespuesta], description: 'Del mas reciente al mas viejo.' })
  intentos!: IntentoRespuesta[];

  @ApiProperty() generadoEn!: Date;
}

/**
 * Del tipo interno al contrato publicado.
 *
 * Se mapea campo a campo, como hace el modulo de evaluacion con `aRespuesta`:
 * asi una columna nueva en una entidad no se filtra sola a la API, y el
 * `idCandidato` que el servicio lleva en cada intento no se repite en cada
 * fila de una respuesta que ya lo trae en la cabecera.
 */
export function aRespuestaDeVacante(r: ReporteDeVacante): ReporteDeVacanteRespuesta {
  return {
    vacante: { id: r.vacante.id, titulo: r.vacante.titulo, estado: r.vacante.estado },
    resumen: {
      ...r.resumen,
      porCriterio: r.resumen.porCriterio.map((c) => ({ ...c })),
    },
    ranking: r.ranking.map((f) => ({
      posicion: f.posicion,
      alias: f.alias,
      idCandidato: f.idCandidato,
      notaFinal: f.notaFinal,
      intentosEvaluados: f.intentosEvaluados,
      idEntrega: f.idEntrega,
      idEvaluacion: f.idEvaluacion,
      evaluadaEn: f.evaluadaEn,
      riesgoInyeccion: f.riesgoInyeccion,
      habilidadDestacada: f.habilidadDestacada,
    })),
    generadoEn: r.generadoEn,
  };
}

export function aRespuestaDeCandidato(r: ReporteDeCandidato): ReporteDeCandidatoRespuesta {
  return {
    vacante: { id: r.vacante.id, titulo: r.vacante.titulo, estado: r.vacante.estado },
    alias: r.alias,
    idCandidato: r.idCandidato,
    posicionEnLaVacante: r.posicionEnLaVacante,
    intentos: r.intentos.map((i) => ({
      idEvaluacion: i.idEvaluacion,
      idEntrega: i.idEntrega,
      idEjercicio: i.idEjercicio,
      notaFinal: i.notaFinal,
      creadaEn: i.creadaEn,
      riesgoInyeccion: i.riesgoInyeccion,
      criterios: i.criterios.map((c) => ({
        criterio: c.criterio,
        puntaje: c.puntaje,
        escalaMaxima: c.escalaMaxima,
        peso: c.peso,
        evidencia: c.evidencia,
      })),
    })),
    generadoEn: r.generadoEn,
  };
}

export class VacantesDelPanelRespuesta {
  @ApiProperty() borradores!: number;
  @ApiProperty() publicadas!: number;
  @ApiProperty() cerradas!: number;
}

export class PanelDeEmpresaRespuesta {
  @ApiProperty({ type: VacantesDelPanelRespuesta }) vacantes!: VacantesDelPanelRespuesta;

  @ApiProperty({
    description:
      'PERSONAS con alguna entrega por evaluar. No es lo mismo que entregas: quien reintenta tiene dos, y el panel diria que hay dos personas donde hay una.',
  })
  finalistasEnEvaluacion!: number;

  @ApiProperty({
    description: 'ENTREGAS recibidas o en evaluacion. Una cola que crece se ve aqui.',
  })
  entregasPorEvaluar!: number;

  @ApiProperty() entregasEvaluadas!: number;
  @ApiProperty() entregasFallidas!: number;
  @ApiProperty({ description: 'Personas contratadas en toda la empresa.' }) contratados!: number;
  @ApiProperty({ description: 'Ejercicios activos del banco. Los retirados no se cuentan.' })
  retosEnElBanco!: number;
  @ApiProperty() generadoEn!: Date;
}
