import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { Entrega } from './entities/entrega.entity.js';
import { EntregasService } from './entregas.service.js';
import {
  DIAS_DE_CONSERVACION,
  Verificacion,
  type ModalidadDeVerificacion,
} from './entities/verificacion.entity.js';
import { AlmacenamientoService } from '../../common/almacenamiento/index.js';
import {
  CUENTA_ELIMINADA,
  ConsentimientosService,
  Rol,
  TipoDeConsentimiento,
  type EventoCuentaEliminada,
} from '../autenticacion/index.js';
import { BusDeEventos } from '../../common/events/index.js';
import type { Solicitante } from '../vacantes/index.js';

/** Cada cuanto se buscan fotos vencidas. Una hora: la promesa es de dias. */
const INTERVALO_DE_PURGA_MS = 60 * 60 * 1000;

export interface ArchivoDeFoto {
  buffer: Buffer;
  mimetype: string;
}

export interface EstadoDeVerificacion {
  modalidad: ModalidadDeVerificacion | null;
  creadaEn: Date | null;
  conservarHasta: Date | null;
  /** Enlace firmado de 5 minutos a la foto. Solo si existe y no se ha purgado. */
  enlace: string | null;
}

/**
 * Verificacion de identidad de una entrega (permiso «verificacion biometrica»).
 *
 * DOS MODALIDADES, UNA ELIGE EL CANDIDATO
 *
 * - `camara`: una foto tomada al entregar. Solo si el candidato AUTORIZA la
 *   verificacion biometrica; sin ese permiso responde 403 y le dice que puede
 *   usar la alterna.
 * - `alterna`: sin foto. La entrega queda marcada para verificacion manual por
 *   la empresa. Revocar el permiso nunca excluye a nadie de una vacante (B16).
 *
 * LA FOTO ES UN DATO BIOMETRICO
 *
 * Va en el bucket privado, se sirve con enlaces de cinco minutos y se BORRA a
 * los 90 dias: `purgarVencidas` cumple esa promesa. No se interpreta ni se
 * compara con nada; es evidencia para una persona.
 */
@Injectable()
export class VerificacionesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Verificaciones');
  private temporizador?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Verificacion) private readonly verificaciones: Repository<Verificacion>,
    private readonly entregas: EntregasService,
    private readonly consentimientos: ConsentimientosService,
    private readonly almacen: AlmacenamientoService,
    private readonly bus: BusDeEventos,
  ) {}

  onModuleInit(): void {
    // Quien elimina su cuenta se lleva sus fotos: son lo mas sensible que guardamos.
    this.bus.suscribir<EventoCuentaEliminada>(CUENTA_ELIMINADA, async (evento) => {
      await this.borrarFotosDe(evento.payload.idUsuario);
    });
    this.temporizador = setInterval(() => {
      this.purgarVencidas().catch((e: unknown) =>
        this.logger.error(`No se pudo purgar: ${e instanceof Error ? e.message : String(e)}`),
      );
    }, INTERVALO_DE_PURGA_MS);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.temporizador);
  }

  async registrar(
    idEntrega: string,
    modalidad: ModalidadDeVerificacion,
    foto: ArchivoDeFoto | undefined,
    solicitante: Solicitante,
  ): Promise<EstadoDeVerificacion> {
    // `obtenerPara` ya responde 404 a quien no puede ver la entrega.
    const entrega = await this.entregas.obtenerPara(idEntrega, solicitante);
    if (solicitante.rol !== Rol.Candidato || entrega.idCandidato !== solicitante.id) {
      throw new ForbiddenException('Solo quien entrego verifica su propia entrega.');
    }
    if (await this.verificaciones.exists({ where: { idEntrega } })) {
      throw new ConflictException('Esta entrega ya tiene su verificacion.');
    }

    if (modalidad === 'alterna') {
      await this.verificaciones.save(
        this.verificaciones.create({ idEntrega, modalidad, clave: null }),
      );
      this.log('verificacion_alterna', solicitante, { idEntrega });
      return this.estado(idEntrega);
    }

    if (!(await this.consentimientos.autoriza(solicitante.id, TipoDeConsentimiento.Biometria))) {
      throw new ForbiddenException(
        'No autorizaste la verificacion biometrica. Puedes usar la modalidad alterna, ' +
          'sin camara, o volver a concederla en Mi cuenta.',
      );
    }
    if (!foto) throw new BadRequestException('Falta la foto (campo "foto").');
    const tipo = tipoDeImagen(foto.buffer);
    if (!tipo) throw new BadRequestException('La foto debe ser una imagen JPEG o PNG.');

    const referencia = await this.almacen.subirVerificacion(
      entrega.idVacante,
      idEntrega,
      foto.buffer,
      tipo,
    );
    try {
      const conservarHasta = new Date(Date.now() + DIAS_DE_CONSERVACION * 24 * 60 * 60 * 1000);
      await this.verificaciones.save(
        this.verificaciones.create({
          idEntrega,
          modalidad,
          clave: referencia.clave,
          tipoContenido: tipo,
          bytes: referencia.bytes,
          sha256: referencia.sha256,
          conservarHasta,
        }),
      );
    } catch (error) {
      // Sin fila nadie podria borrar la foto a los 90 dias: se compensa.
      await this.almacen.eliminar(referencia);
      throw error;
    }
    this.log('verificacion_con_camara', solicitante, { idEntrega });
    return this.estado(idEntrega);
  }

  /** Lo ve quien puede ver la entrega: su candidato, o la empresa dueña de la vacante. */
  async deEntrega(idEntrega: string, solicitante: Solicitante): Promise<EstadoDeVerificacion> {
    await this.entregas.obtenerPara(idEntrega, solicitante);
    return this.estado(idEntrega);
  }

  /** Borra todas las fotos de verificacion de una persona, sin esperar a los 90 dias. */
  async borrarFotosDe(idCandidato: string): Promise<number> {
    const filas = await this.verificaciones
      .createQueryBuilder('v')
      .innerJoin(Entrega, 'e', 'e.id = v.idEntrega')
      .where('e.idCandidato = :idCandidato', { idCandidato })
      .andWhere('v.clave IS NOT NULL')
      .getMany();
    for (const v of filas) await this.#borrar(v, new Date());
    return filas.length;
  }

  async #borrar(v: Verificacion, ahora: Date): Promise<void> {
    await this.almacen.eliminar({
      clave: v.clave!,
      bytes: v.bytes ?? 0,
      sha256: v.sha256 ?? '',
      tipoContenido: v.tipoContenido ?? '',
      nombreOriginal: '',
    });
    await this.verificaciones.update(
      { id: v.id },
      { clave: null, tipoContenido: null, bytes: null, sha256: null, purgadaEn: ahora },
    );
  }

  /** Borra las fotos pasada su fecha. Devuelve cuantas. */
  async purgarVencidas(ahora = new Date()): Promise<number> {
    const vencidas = await this.verificaciones.find({
      where: { conservarHasta: LessThan(ahora), clave: Not(IsNull()) },
    });
    for (const v of vencidas) await this.#borrar(v, ahora);
    if (vencidas.length > 0) this.logger.log(`Fotos de verificacion purgadas: ${vencidas.length}`);
    return vencidas.length;
  }

  private async estado(idEntrega: string): Promise<EstadoDeVerificacion> {
    const v = await this.verificaciones.findOne({ where: { idEntrega } });
    if (!v) return { modalidad: null, creadaEn: null, conservarHasta: null, enlace: null };
    const enlace = v.clave
      ? await this.almacen.enlaceDeDescarga({
          clave: v.clave,
          bytes: v.bytes ?? 0,
          sha256: v.sha256 ?? '',
          tipoContenido: v.tipoContenido ?? '',
          nombreOriginal: '',
        })
      : null;
    return {
      modalidad: v.modalidad,
      creadaEn: v.creadaEn,
      conservarHasta: v.conservarHasta,
      enlace,
    };
  }

  private log(eventType: string, solicitante: Solicitante, metadata: object): void {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        eventType,
        userId: solicitante.id,
        metadata,
      }),
    );
  }
}

/** Reconoce JPEG y PNG por sus primeros bytes: el tipo que declara el cliente no vale. */
function tipoDeImagen(b: Buffer): 'image/jpeg' | 'image/png' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  return null;
}
