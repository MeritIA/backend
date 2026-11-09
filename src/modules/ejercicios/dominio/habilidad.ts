/**
 * La clave de comparacion de un nombre de habilidad.
 *
 * VIVE EN `ejercicios` PORQUE AQUI NACEN LOS NOMBRES
 *
 * Un nombre de habilidad es, en origen, el nombre de un criterio de rubrica, y
 * las rubricas son de este modulo. Antes esta funcion estaba en `evaluacion`,
 * que es donde primero se necesito, pero el dueno del concepto es quien lo
 * define: `evaluacion` y `reportes` dependen de `ejercicios`, asi que los dos
 * pueden usarla desde aqui y no hay dos copias que se puedan desincronizar.
 *
 * QUE NORMALIZA, Y QUE YA NO HACE FALTA QUE NORMALICE
 *
 * Mayusculas, acentos y espacios de sobra. Asi "Correccion funcional",
 * "corrección funcional" y "  Corrección  Funcional " son la misma clave, que
 * es lo que dos reclutadores escribiendo lo mismo produce en la practica.
 *
 * Los SINONIMOS ya no son su problema: eso lo resuelve el vocabulario
 * (`HabilidadesService.resolver`). Esta funcion es el primer paso de esa
 * traduccion, no toda la traduccion. La diferencia importa: "Legibilidad" y
 * "Claridad del codigo" tienen claves distintas aqui, y es el catalogo el que
 * las une.
 */
export function normalizarNombreDeHabilidad(nombre: string): string {
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
