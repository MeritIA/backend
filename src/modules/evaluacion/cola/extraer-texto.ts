import { extname } from 'node:path';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';

/**
 * Convierte el archivo de una entrega en texto para evaluar.
 *
 * POR QUE AQUI Y NO EN EL SERVICIO DE IA
 *
 * Decision del equipo (2026-09-23): el servicio de IA no procesa archivos no
 * confiables. Abrir un comprimido que subio un desconocido es superficie de
 * ataque, y este modulo ya corre con la entrega delante. El servicio de IA solo
 * recibe texto, que es lo que necesita para calificar.
 *
 * CONTRA QUE SE DEFIENDE
 *
 * - **Bombas de descompresion**: un zip de 1 MB puede producir gigabytes. Se
 *   corta por numero de archivos, por tamano de cada uno y por total
 *   descomprimido, leyendo entrada por entrada en vez de todo de golpe.
 * - **Zip slip**: rutas con `..` o absolutas. yauzl ya rechaza el comprimido
 *   entero en ese caso; la comprobacion propia se mantiene como defensa en
 *   profundidad, para que cambiar de libreria no abra el agujero en silencio.
 *   Aqui nada se escribe en disco, pero una ruta asi tampoco tiene por que
 *   llegar al prompt del modelo.
 * - **Binarios disfrazados**: solo se leen las extensiones de texto, y se
 *   descarta lo que traiga bytes nulos.
 */

export const MAX_ARCHIVOS = 200;
export const MAX_BYTES_POR_ARCHIVO = 500_000;
/** Tope de todo lo extraido. Por debajo del limite de cuerpo del servicio de IA (2 MB). */
export const MAX_BYTES_TOTAL = 1_500_000;

/** Lo que se sabe leer dentro de un comprimido o suelto. */
export const EXTENSIONES_DE_TEXTO = new Set([
  '.txt',
  '.md',
  '.sql',
  '.json',
  '.ipynb',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.kt',
  '.cs',
  '.go',
  '.rb',
  '.php',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.csv',
  '.sh',
  '.env.example',
]);

export type MotivoIlegible =
  'formato_no_soportado' | 'sin_archivos_legibles' | 'comprimido_invalido' | 'demasiado_grande';

/**
 * La entrega no se puede convertir en texto.
 *
 * Es la "respuesta para cuando no se acepta" que pidio el equipo: la entrega
 * queda `fallida` con un motivo entendible, y no se reintenta, porque el
 * archivo no va a cambiar solo.
 */
export class EntregaIlegibleError extends Error {
  override readonly name = 'EntregaIlegibleError';

  constructor(
    readonly motivo: MotivoIlegible,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export interface ArchivoDeTexto {
  readonly ruta: string;
  readonly contenido: string;
}

function esRutaSegura(ruta: string): boolean {
  if (ruta.startsWith('/') || /^[a-zA-Z]:/.test(ruta)) return false;
  return !ruta.split(/[\\/]/).includes('..');
}

function esTexto(ruta: string): boolean {
  const nombre = ruta.toLowerCase();
  if (nombre.endsWith('.env.example')) return true;
  return EXTENSIONES_DE_TEXTO.has(extname(nombre));
}

/** Un binario disfrazado de .txt trae bytes nulos; el texto de verdad, no. */
function pareceBinario(contenido: Buffer): boolean {
  return contenido.includes(0);
}

export async function extraerTexto(
  contenido: Buffer,
  nombreOriginal: string,
): Promise<ArchivoDeTexto[]> {
  const extension = extname(nombreOriginal).toLowerCase();

  if (extension === '.zip') return extraerDeZip(contenido);

  if (esTexto(nombreOriginal)) {
    if (contenido.length > MAX_BYTES_TOTAL) {
      throw new EntregaIlegibleError(
        'demasiado_grande',
        'El archivo supera el tamano que se puede enviar a evaluar.',
      );
    }
    if (pareceBinario(contenido)) {
      throw new EntregaIlegibleError(
        'sin_archivos_legibles',
        'El archivo no contiene texto legible.',
      );
    }
    return [{ ruta: nombreOriginal, contenido: contenido.toString('utf8') }];
  }

  // .pdf, .tar, .gz y .tgz se admiten al subir pero todavia no se saben leer.
  throw new EntregaIlegibleError(
    'formato_no_soportado',
    `Las entregas en formato ${extension || 'desconocido'} todavia no se evaluan automaticamente. Sube un .zip o un archivo de texto.`,
  );
}

function extraerDeZip(contenido: Buffer): Promise<ArchivoDeTexto[]> {
  return new Promise((resolver, rechazar) => {
    fromBuffer(contenido, { lazyEntries: true }, (error, zip: ZipFile) => {
      if (error || !zip) {
        rechazar(
          new EntregaIlegibleError('comprimido_invalido', 'El archivo .zip no se pudo abrir.'),
        );
        return;
      }

      const archivos: ArchivoDeTexto[] = [];
      let bytes = 0;
      let terminado = false;

      const fallar = (e: EntregaIlegibleError) => {
        if (terminado) return;
        terminado = true;
        zip.close();
        rechazar(e);
      };

      zip.on('error', () =>
        fallar(new EntregaIlegibleError('comprimido_invalido', 'El archivo .zip esta corrupto.')),
      );

      zip.on('entry', (entrada: Entry) => {
        if (terminado) return;

        const ruta = entrada.fileName;
        // Directorios, rutas sospechosas y lo que no es texto: se ignoran.
        if (ruta.endsWith('/') || !esRutaSegura(ruta) || !esTexto(ruta)) {
          zip.readEntry();
          return;
        }
        // El tamano declarado se comprueba ANTES de descomprimir: es lo que
        // impide que una bomba se expanda en memoria.
        if (entrada.uncompressedSize > MAX_BYTES_POR_ARCHIVO) {
          zip.readEntry();
          return;
        }
        if (archivos.length >= MAX_ARCHIVOS) {
          fallar(
            new EntregaIlegibleError(
              'demasiado_grande',
              `La entrega tiene mas de ${MAX_ARCHIVOS} archivos de texto.`,
            ),
          );
          return;
        }

        zip.openReadStream(entrada, (errorLectura, flujo) => {
          if (terminado) return;
          if (errorLectura || !flujo) {
            zip.readEntry();
            return;
          }

          const trozos: Buffer[] = [];
          let bytesDeEste = 0;

          flujo.on('data', (trozo: Buffer) => {
            bytesDeEste += trozo.length;
            bytes += trozo.length;
            // El tamano real, no el declarado: un zip puede mentir en su cabecera.
            if (bytesDeEste > MAX_BYTES_POR_ARCHIVO || bytes > MAX_BYTES_TOTAL) {
              flujo.destroy();
              return;
            }
            trozos.push(trozo);
          });

          flujo.on('error', () => zip.readEntry());

          flujo.on('close', () => {
            if (terminado) return;
            if (bytes > MAX_BYTES_TOTAL) {
              fallar(
                new EntregaIlegibleError(
                  'demasiado_grande',
                  'La entrega descomprimida supera el tamano que se puede evaluar.',
                ),
              );
              return;
            }
            const datos = Buffer.concat(trozos);
            if (bytesDeEste <= MAX_BYTES_POR_ARCHIVO && !pareceBinario(datos)) {
              archivos.push({ ruta, contenido: datos.toString('utf8') });
            }
            zip.readEntry();
          });
        });
      });

      zip.on('end', () => {
        if (terminado) return;
        terminado = true;
        if (archivos.length === 0) {
          rechazar(
            new EntregaIlegibleError(
              'sin_archivos_legibles',
              'El .zip no trae ningun archivo de texto que se pueda evaluar.',
            ),
          );
          return;
        }
        resolver(archivos);
      });

      zip.readEntry();
    });
  });
}
