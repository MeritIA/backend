import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Evaluacion } from '../entities/evaluacion.entity.js';

export class CalificacionRespuesta {
  @ApiProperty() criterio!: string;
  @ApiProperty() puntaje!: number;
  @ApiProperty() escalaMaxima!: number;
  @ApiProperty({ description: 'Cuanto aporta el criterio a la nota final. Suman 100.' })
  peso!: number;
  @ApiProperty({ description: 'Por que ese puntaje, con referencia a la entrega.' })
  evidencia!: string;
}

export class BanderaRespuesta {
  @ApiProperty({ example: 'evasion_de_instrucciones' }) codigo!: string;
  @ApiProperty() archivo!: string;
  @ApiProperty() ocurrencias!: number;
}

/**
 * Auditoria anti inyeccion (paquete 4.2).
 *
 * Se devuelve al reclutador y al administrador, NO al candidato: saber que
 * patron se detecto y con que puntaje es justo lo que necesitaria para afinar
 * el siguiente intento.
 */
export class SeguridadRespuesta {
  @ApiProperty({ enum: ['ninguno', 'bajo', 'medio', 'alto'] }) riesgo!: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) puntaje!: number;
  @ApiProperty({ type: [BanderaRespuesta] }) banderas!: BanderaRespuesta[];
  @ApiProperty() versionReglas!: string;
  @ApiProperty() versionListaNegra!: string;
}

export class EvaluacionRespuesta {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) idEntrega!: string;
  @ApiProperty({ format: 'uuid' }) idVacante!: string;
  @ApiProperty({ format: 'uuid' }) idCandidato!: string;
  @ApiProperty({ format: 'uuid' }) idEjercicio!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Version de la rubrica con la que se califico. La rubrica puede cambiar despues; la nota se explica con esta.',
  })
  idVersion!: string;

  @ApiProperty({ minimum: 0, maximum: 100 }) notaFinal!: number;
  @ApiProperty({ type: [CalificacionRespuesta], description: 'En el orden de la rubrica.' })
  criterios!: CalificacionRespuesta[];

  @ApiProperty({ example: 'gemini' }) proveedor!: string;
  @ApiProperty({ example: 'gemini-3.5-flash' }) modelo!: string;
  @ApiProperty() creadaEn!: Date;

  @ApiPropertyOptional({
    type: SeguridadRespuesta,
    description: 'Solo para el reclutador de la vacante o un administrador.',
  })
  seguridad?: SeguridadRespuesta;
}

export function aRespuesta(
  e: Evaluacion,
  opciones: { conSeguridad: boolean } = { conSeguridad: false },
): EvaluacionRespuesta {
  return {
    id: e.id,
    idEntrega: e.idEntrega,
    idVacante: e.idVacante,
    idCandidato: e.idCandidato,
    idEjercicio: e.idEjercicio,
    idVersion: e.idVersion,
    notaFinal: e.notaFinal,
    criterios: (e.criterios ?? []).map((c) => ({
      criterio: c.criterio,
      puntaje: c.puntaje,
      escalaMaxima: c.escalaMaxima,
      peso: c.peso,
      evidencia: c.evidencia,
    })),
    proveedor: e.proveedor,
    modelo: e.modelo,
    creadaEn: e.creadaEn,
    ...(opciones.conSeguridad
      ? {
          seguridad: {
            riesgo: e.riesgoInyeccion,
            puntaje: e.puntajeInyeccion,
            banderas: e.banderas ?? [],
            versionReglas: e.versionReglas,
            versionListaNegra: e.versionListaNegra,
          },
        }
      : {}),
  };
}
