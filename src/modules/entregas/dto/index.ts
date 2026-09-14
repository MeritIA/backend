import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { EstadoEntrega } from '../dominio/estado-entrega.js';
import type { Entrega } from '../entities/entrega.entity.js';

/** Campos de texto del formulario multipart; el archivo va en el campo "archivo". */
export class CrearEntregaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'idVacante debe ser un identificador valido' })
  idVacante!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'idEjercicio debe ser un identificador valido' })
  idEjercicio!: string;
}

export class FiltroMiasDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'idVacante debe ser un identificador valido' })
  idVacante?: string;
}

export class HistorialRespuesta {
  @ApiPropertyOptional({ enum: EstadoEntrega, nullable: true })
  desde!: EstadoEntrega | null;

  @ApiProperty({ enum: EstadoEntrega })
  hacia!: EstadoEntrega;

  @ApiPropertyOptional({ nullable: true })
  motivo!: string | null;

  @ApiProperty()
  momento!: Date;
}

/**
 * Lo que ve el cliente de una entrega.
 *
 * NO incluye la clave del objeto en el almacenamiento: el bucket es privado y
 * la clave no abre nada, pero es un detalle interno que no hace falta regalar.
 * Para descargar esta el endpoint de descarga, que firma un enlace temporal.
 */
export class EntregaRespuesta {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) idVacante!: string;
  @ApiProperty({ format: 'uuid' }) idCandidato!: string;
  @ApiProperty({ format: 'uuid' }) idEjercicio!: string;
  @ApiProperty() numeroIntento!: number;
  @ApiProperty({ enum: EstadoEntrega }) estado!: EstadoEntrega;
  @ApiProperty() archivoNombre!: string;
  @ApiProperty() archivoBytes!: number;
  @ApiProperty({ description: 'SHA-256 del archivo, para verificar su integridad.' })
  archivoSha256!: string;
  @ApiProperty() creadaEn!: Date;
  @ApiPropertyOptional({ type: [HistorialRespuesta] }) historial?: HistorialRespuesta[];
}

export function aRespuesta(e: Entrega): EntregaRespuesta {
  return {
    id: e.id,
    idVacante: e.idVacante,
    idCandidato: e.idCandidato,
    idEjercicio: e.idEjercicio,
    numeroIntento: e.numeroIntento,
    estado: e.estado,
    archivoNombre: e.archivoNombre,
    archivoBytes: e.archivoBytes,
    archivoSha256: e.archivoSha256,
    creadaEn: e.creadaEn,
    ...(e.historial
      ? {
          historial: e.historial.map((h) => ({
            desde: h.desde,
            hacia: h.hacia,
            motivo: h.motivo,
            momento: h.momento,
          })),
        }
      : {}),
  };
}
