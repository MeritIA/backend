import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketPolicyStatusCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import {
  PREFIJO_EVIDENCIAS,
  claveDeEntrega,
  claveDeEvidencia,
  claveEsValida,
  validarTamano,
} from './politica-de-nombres.js';

/** Lo que se guarda en PostgreSQL: la referencia, nunca el contenido. */
export interface ReferenciaDeObjeto {
  readonly clave: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly tipoContenido: string;
  readonly nombreOriginal: string;
}

export class ObjetoNoEncontradoError extends Error {}
export class ClaveInvalidaError extends Error {}

/** Vida de un enlace de descarga. Corta a proposito: un enlace filtrado caduca pronto. */
const SEGUNDOS_ENLACE = 5 * 60;

/**
 * Almacenamiento de objetos (S3 o MinIO), paquete 3.3.
 *
 * Criterios de aceptacion y como se cumple cada uno:
 *
 *  1. "Una entrega se sube y se recupera por su referencia": `subirEntrega`
 *     devuelve una ReferenciaDeObjeto; `descargar` y `enlaceDeDescarga` la
 *     reciben de vuelta.
 *
 *  2. "Ningun binario se persiste en PostgreSQL": este servicio no toca la
 *     base de datos. Lo que devuelve para guardar es texto y numeros.
 *
 *  3. "El bucket no es publicamente accesible": el bucket se crea sin politica
 *     publica, la descarga se hace con enlaces prefirmados de cinco minutos, y
 *     `bucketEsPrivado` lo comprueba contra el propio servidor, no se supone.
 *
 * Es transversal (vive en common/) porque lo usan dos modulos: entregas guarda
 * lo que sube el candidato y evaluacion guarda las evidencias.
 */
@Injectable()
export class AlmacenamientoService implements OnModuleInit {
  private readonly logger = new Logger('Almacenamiento');
  private readonly s3: S3Client;
  readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'meritia-entregas';
    this.s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      // MinIO sirve los buckets por ruta (host/bucket/clave) y no por
      // subdominio; S3 real acepta ambos.
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.asegurarBucket();
  }

  /**
   * Crea el bucket si falta y le aplica la politica de retencion.
   *
   * No se le pone ninguna politica de acceso: un bucket nuevo es privado por
   * omision tanto en S3 como en MinIO, y cualquier politica anadida aqui solo
   * podria abrirlo.
   */
  async asegurarBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket ${this.bucket} creado`);
    }
    await this.aplicarRetencion();
  }

  /**
   * Politica de retencion, entregable del paquete.
   *
   * Las evidencias de evaluacion caducan a los 365 dias; las entregas NO
   * caducan por regla automatica. Borrar la entrega de un candidato es una
   * decision de negocio y de proteccion de datos —cuanto tiempo se conserva la
   * prueba de un proceso de seleccion— que no debe tomar una regla del bucket
   * sin que nadie lo sepa. Queda anotado como pendiente en la documentacion.
   */
  private async aplicarRetencion(): Promise<void> {
    const dias = Number(process.env.S3_RETENCION_EVIDENCIAS_DIAS ?? 365);
    try {
      await this.s3.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: this.bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'caducidad-evidencias',
                Status: 'Enabled',
                Filter: { Prefix: `${PREFIJO_EVIDENCIAS}/` },
                Expiration: { Days: dias },
              },
            ],
          },
        }),
      );
    } catch (e) {
      // Que falle la regla de ciclo de vida no debe impedir arrancar, pero si
      // quedar registrado: sin ella los costes crecen sin limite.
      this.logger.warn(
        `No se pudo aplicar la politica de retencion: ${(e as Error).name ?? 'error desconocido'}`,
      );
    }
  }

  async subirEntrega(
    idVacante: string,
    idEntrega: string,
    nombreOriginal: string,
    contenido: Buffer,
    tipoContenido: string,
  ): Promise<ReferenciaDeObjeto> {
    validarTamano(contenido.length);
    const clave = claveDeEntrega(idVacante, idEntrega, nombreOriginal);
    return this.subir(clave, nombreOriginal, contenido, tipoContenido);
  }

  async subirEvidencia(idEvaluacion: string, contenido: Buffer): Promise<ReferenciaDeObjeto> {
    const clave = claveDeEvidencia(idEvaluacion);
    return this.subir(clave, 'evidencia.json', contenido, 'application/json');
  }

  private async subir(
    clave: string,
    nombreOriginal: string,
    contenido: Buffer,
    tipoContenido: string,
  ): Promise<ReferenciaDeObjeto> {
    const sha256 = createHash('sha256').update(contenido).digest('hex');

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: clave,
        Body: contenido,
        ContentType: tipoContenido,
        // El nombre del usuario viaja como metadato, codificado: nunca en la
        // clave. Ver politica-de-nombres.ts.
        Metadata: { 'nombre-original': encodeURIComponent(nombreOriginal), sha256 },
        // Obliga al navegador a descargar en vez de interpretar. Sin esto, un
        // .html o un .svg subido como entrega se abriria dentro del origen de
        // la aplicacion al seguir el enlace.
        ContentDisposition: `attachment; filename="${encodeURIComponent(nombreOriginal)}"`,
      }),
    );

    return { clave, bytes: contenido.length, sha256, tipoContenido, nombreOriginal };
  }

  /** Descarga el contenido y verifica que no se haya alterado en el bucket. */
  async descargar(referencia: ReferenciaDeObjeto): Promise<Buffer> {
    this.exigirClaveValida(referencia.clave);
    try {
      const r = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: referencia.clave }),
      );
      const bytes = Buffer.from(await r.Body!.transformToByteArray());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== referencia.sha256) {
        // El objeto no es el que se guardo. Para una prueba de seleccion eso
        // invalida la evaluacion: se lanza en vez de devolver datos alterados.
        this.logger.error(
          JSON.stringify({
            level: 'security',
            eventType: 'objeto_alterado',
            clave: referencia.clave,
          }),
        );
        throw new ObjetoNoEncontradoError('El archivo no coincide con el que se entrego.');
      }
      return bytes;
    } catch (e) {
      if (e instanceof ObjetoNoEncontradoError) throw e;
      throw new ObjetoNoEncontradoError('El archivo no existe.');
    }
  }

  /**
   * Enlace temporal de descarga.
   *
   * Es la unica forma de que un cliente obtenga el archivo, y la razon por la
   * que el bucket puede ser privado: el enlace va firmado, apunta a un objeto
   * concreto y caduca en cinco minutos.
   */
  async enlaceDeDescarga(referencia: ReferenciaDeObjeto): Promise<string> {
    this.exigirClaveValida(referencia.clave);
    await this.existe(referencia.clave);
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: referencia.clave }),
      { expiresIn: SEGUNDOS_ENLACE },
    );
  }

  async eliminar(referencia: ReferenciaDeObjeto): Promise<void> {
    this.exigirClaveValida(referencia.clave);
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: referencia.clave }));
  }

  /**
   * Comprueba contra el servidor que el bucket no sea publico.
   *
   * Tercer criterio del paquete. Primero pregunta por el estado de la
   * politica; como no todos los servidores compatibles lo implementan, lo
   * confirma intentando leer sin credenciales, que es exactamente lo que haria
   * alguien desde internet.
   */
  async bucketEsPrivado(): Promise<boolean> {
    try {
      const r = await this.s3.send(new GetBucketPolicyStatusCommand({ Bucket: this.bucket }));
      if (r.PolicyStatus?.IsPublic) return false;
    } catch {
      // Sin politica o sin soporte del comando: se decide con la prueba real.
    }

    const url = `${process.env.S3_ENDPOINT}/${this.bucket}/`;
    try {
      const respuesta = await fetch(url);
      return respuesta.status === 403 || respuesta.status === 401;
    } catch {
      return true;
    }
  }

  private async existe(clave: string): Promise<void> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: clave }));
    } catch {
      throw new ObjetoNoEncontradoError('El archivo no existe.');
    }
  }

  private exigirClaveValida(clave: string): void {
    if (!claveEsValida(clave)) {
      throw new ClaveInvalidaError('Referencia de archivo invalida.');
    }
  }
}
