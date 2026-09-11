import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hashing de contrasenas y derivacion del hash de busqueda del correo.
 *
 * DECISION NO CUBIERTA POR LOS DOCUMENTOS
 *
 * El Plan de Seguridad exige "algoritmos seguros de hashing" y prohibe guardar
 * contrasenas en texto plano, pero **no nombra cual**. El encuadre permite
 * tomar la decision siempre que se justifique, asi que:
 *
 * **argon2id**, que es la primera recomendacion de OWASP para contrasenas
 * nuevas. Es resistente tanto a ataques con GPU como a los de canal lateral por
 * tiempo de acceso a memoria, y su coste se puede subir con el hardware sin
 * cambiar de algoritmo. bcrypt seria aceptable, pero limita la contrasena a 72
 * bytes y no tiene parametro de memoria.
 *
 * Se usa @node-rs/argon2 y no la implementacion de node-gyp porque trae
 * binarios precompilados: nadie del equipo necesita un compilador de C++ para
 * levantar el proyecto.
 *
 * Los parametros son los del perfil recomendado por OWASP: 19 MiB de memoria,
 * dos iteraciones y un grado de paralelismo.
 */

// `Algorithm` de @node-rs/argon2 es un const enum ambiental y con
// isolatedModules no se puede leer, asi que se usa su valor. 2 = Argon2id.
const ARGON2ID = 2;

const PARAMETROS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class ContrasenasService {
  async cifrar(contrasenaEnClaro: string): Promise<string> {
    return hash(contrasenaEnClaro, PARAMETROS);
  }

  /**
   * Comprueba una contrasena contra su hash.
   *
   * Devuelve false ante un hash corrupto o de otro formato en vez de lanzar: un
   * fallo aqui no debe distinguirse de una contrasena equivocada, porque esa
   * diferencia le dice a quien prueba que la cuenta existe.
   */
  async coincide(contrasenaEnClaro: string, hashGuardado: string): Promise<boolean> {
    try {
      return await verify(hashGuardado, contrasenaEnClaro, PARAMETROS);
    } catch {
      return false;
    }
  }

  /**
   * Hash de busqueda del correo.
   *
   * Deterministico a proposito: la columna `correo` va cifrada con IV aleatorio
   * y no se puede buscar por ella. El correo se normaliza antes (minusculas y
   * sin espacios) para que `Ana@X.com` y `ana@x.com ` sean el mismo usuario.
   */
  hashDeCorreo(correo: string): string {
    return createHash('sha256').update(normalizarCorreo(correo)).digest('hex');
  }

  /** Comparacion en tiempo constante, para no filtrar por el tiempo de respuesta. */
  static sonIguales(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}

export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}
