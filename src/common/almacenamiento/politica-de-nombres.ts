import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Politica de nombres de objetos, entregable del paquete 3.3.
 *
 * DOS REGLAS, Y LAS DOS SON DE SEGURIDAD
 *
 * 1. **El nombre que envia el usuario NUNCA forma parte de la clave.** Se
 *    guarda como metadato, para poder devolverlo al descargar, pero la clave se
 *    construye con un UUID. Un nombre de archivo es entrada no confiable: con
 *    `../../` se sale del prefijo previsto, y hay caracteres que en S3
 *    significan cosas distintas que en un sistema de ficheros.
 *
 * 2. **La clave no se puede adivinar.** Aunque el bucket sea privado, una clave
 *    predecible del tipo `entregas/vacante-1/candidato-2.pdf` convierte
 *    cualquier fuga de credenciales, o un enlace prefirmado filtrado, en acceso
 *    a todo el historial. El UUID lo impide.
 *
 * ESTRUCTURA
 *
 *   entregas/<idVacante>/<idEntrega>/<uuid><extension>
 *   evidencias/<idEvaluacion>/<uuid><extension>
 *
 * El prefijo por vacante no es decorativo: permite aplicar retencion o borrado
 * por proceso de seleccion sin recorrer el bucket entero, y es lo que hace
 * viable la politica de retencion que pide la ficha.
 */

export const PREFIJO_ENTREGAS = 'entregas';
export const PREFIJO_EVIDENCIAS = 'evidencias';
export const PREFIJO_VERIFICACIONES = 'verificaciones';
export const PREFIJO_ADJUNTOS = 'adjuntos';

/**
 * Extensiones admitidas en una entrega.
 *
 * Lista blanca y no lista negra: una negra se queda corta con la siguiente
 * extension que alguien invente. Se admite lo que un candidato entrega de
 * verdad —codigo comprimido, un documento, un cuaderno— y nada mas.
 */
export const EXTENSIONES_PERMITIDAS = [
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.pdf',
  '.md',
  '.txt',
  '.ipynb',
  '.sql',
  '.json',
] as const;

export const TAMANO_MAXIMO_BYTES = 25 * 1024 * 1024; // 25 MiB

export type MotivoArchivoInvalido =
  'extension_no_permitida' | 'sin_extension' | 'demasiado_grande' | 'vacio' | 'nombre_invalido';

export class ArchivoInvalidoError extends Error {
  constructor(
    readonly motivo: MotivoArchivoInvalido,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/**
 * Extension en minusculas, validada contra la lista blanca.
 *
 * Se usa `path.posix.basename` sobre el nombre ya recortado para quedarnos solo
 * con la ultima parte: si llega `../../etc/passwd.zip`, lo que se mira es
 * `passwd.zip`. La clave final no usa el nombre de todos modos, pero validar
 * sobre el nombre completo daria una falsa sensacion de seguridad.
 */
export function extensionValidada(nombreOriginal: string): string {
  const limpio = nombreOriginal.trim();
  if (!limpio || limpio.length > 255) {
    throw new ArchivoInvalidoError('nombre_invalido', 'El nombre del archivo no es valido.');
  }

  const base = path.posix.basename(limpio.replace(/\\/g, '/'));
  const extension = path.posix.extname(base).toLowerCase();

  if (!extension) {
    throw new ArchivoInvalidoError(
      'sin_extension',
      'El archivo debe tener extension. Admitidas: ' + EXTENSIONES_PERMITIDAS.join(', '),
    );
  }
  if (!(EXTENSIONES_PERMITIDAS as readonly string[]).includes(extension)) {
    throw new ArchivoInvalidoError(
      'extension_no_permitida',
      `La extension "${extension}" no esta permitida. Admitidas: ${EXTENSIONES_PERMITIDAS.join(', ')}`,
    );
  }
  return extension;
}

export function validarTamano(bytes: number): void {
  if (bytes <= 0) {
    throw new ArchivoInvalidoError('vacio', 'El archivo esta vacio.');
  }
  if (bytes > TAMANO_MAXIMO_BYTES) {
    const mb = (TAMANO_MAXIMO_BYTES / 1024 / 1024).toFixed(0);
    throw new ArchivoInvalidoError('demasiado_grande', `El archivo supera el maximo de ${mb} MiB.`);
  }
}

/** Clave de una entrega de candidato. */
export function claveDeEntrega(
  idVacante: string,
  idEntrega: string,
  nombreOriginal: string,
): string {
  const extension = extensionValidada(nombreOriginal);
  return `${PREFIJO_ENTREGAS}/${idVacante}/${idEntrega}/${randomUUID()}${extension}`;
}

/** Clave de un archivo que acompana un enunciado. Misma lista blanca de extensiones. */
export function claveDeAdjunto(idEjercicio: string, nombreOriginal: string): string {
  // Un dataset suele ser .csv, que una ENTREGA no admite: la evaluacion no lo lee.
  const extension = nombreOriginal.toLowerCase().endsWith('.csv')
    ? '.csv'
    : extensionValidada(nombreOriginal);
  return `${PREFIJO_ADJUNTOS}/${idEjercicio}/${randomUUID()}${extension}`;
}

/** Clave de la foto de verificacion de una entrega. Solo imagenes: jpg o png. */
export function claveDeVerificacion(
  idVacante: string,
  idEntrega: string,
  extension: '.jpg' | '.png',
): string {
  return `${PREFIJO_VERIFICACIONES}/${idVacante}/${idEntrega}/${randomUUID()}${extension}`;
}

/** Clave de una evidencia generada durante la evaluacion. */
export function claveDeEvidencia(idEvaluacion: string, extension = '.json'): string {
  return `${PREFIJO_EVIDENCIAS}/${idEvaluacion}/${randomUUID()}${extension}`;
}

/**
 * Comprueba que una clave no se salga de los prefijos previstos.
 *
 * Segunda linea de defensa: las claves las genera este modulo, pero una que
 * venga de la base de datos pudo escribirse cuando el codigo era otro, y nadie
 * quiere descubrir eso sirviendo un objeto de fuera del arbol.
 */
export function claveEsValida(clave: string): boolean {
  if (!clave || clave.length > 1024) return false;
  if (clave.includes('..') || clave.startsWith('/') || clave.includes('//')) return false;
  // Caracteres de control y espacios: se comprueban por codigo y no con un
  // regex, porque un patron con bytes de control invisibles no se puede leer
  // al revisarlo, y una regla de seguridad que no se lee no se revisa.
  for (const c of clave) {
    const codigo = c.codePointAt(0) ?? 0;
    if (codigo <= 0x20 || codigo === 0x7f) return false;
  }
  return (
    clave.startsWith(`${PREFIJO_ENTREGAS}/`) ||
    clave.startsWith(`${PREFIJO_EVIDENCIAS}/`) ||
    clave.startsWith(`${PREFIJO_VERIFICACIONES}/`) ||
    clave.startsWith(`${PREFIJO_ADJUNTOS}/`)
  );
}
