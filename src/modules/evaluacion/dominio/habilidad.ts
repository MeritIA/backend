/**
 * El nombre de una habilidad, normalizado.
 *
 * NO HAY TAXONOMIA DE HABILIDADES, Y HAY QUE SABERLO
 *
 * El perfil de un candidato se construye con los nombres de criterio que los
 * reclutadores escribieron en sus rubricas. No existe un vocabulario cerrado:
 * `criterios_rubrica.nombre` es texto libre de 120 caracteres.
 *
 * Esto normaliza lo unico que se puede normalizar sin inventar: mayusculas,
 * acentos y espacios de sobra. Asi "Correccion funcional", "corrección
 * funcional" y "  Corrección  Funcional " son la misma habilidad, que es lo que
 * dos reclutadores distintos escribiendo lo mismo produce en la practica.
 *
 * LO QUE NO HACE, DICHO PARA QUE NADIE LO SUPONGA
 *
 * No hay sinonimos, ni raices, ni nada semantico. "Claridad del codigo" y
 * "Legibilidad" son DOS habilidades distintas para este codigo, aunque una
 * persona las juntaria. Resolver eso es un vocabulario de habilidades --una
 * decision de producto, con su mantenimiento-- y no una funcion de texto.
 *
 * La consecuencia practica: la afinidad funciona bien cuando las empresas
 * reutilizan ejercicios del banco, y se degrada cuando cada una inventa sus
 * propios nombres de criterio. Eso esta en el ADR-0016.
 */
export function normalizarHabilidad(nombre: string): string {
  return (
    nombre
      // NFD separa la letra de su acento, y el replace se lleva el acento.
      .normalize('NFD')
      // Se usa la propiedad Unicode y NO un rango de codigos escrito a mano:
      // ese rango son caracteres combinantes INVISIBLES en el fuente, que es
      // justo el problema que este proyecto ya tuvo que excepcionar una vez en
      // el lint del servicio de IA. Esto es ASCII y se lee.
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Nivel demostrado en una habilidad, de 0 a 1, con cuanta evidencia lo sostiene. */
export interface NivelDeHabilidad {
  /** El nombre tal como se escribio la ultima vez, para poder mostrarlo. */
  readonly nombre: string;
  /** Media de puntaje/escala en todas las veces que se califico. 0 a 1. */
  readonly nivel: number;
  /** Cuantas calificaciones lo sostienen. Uno no es lo mismo que seis. */
  readonly veces: number;
}
