import { createHash } from 'node:crypto';

/**
 * Alias con el que un candidato aparece en el ranking, en lugar de su nombre.
 *
 * POR QUE EL RANKING NO LLEVA NOMBRE
 *
 * El objetivo del producto es **reducir el sesgo** en la evaluacion, y los
 * mockups del proyecto lo instrumentan en la pantalla A06: "Identidad oculta
 * hasta que selecciones a quien contactar". Un nombre en la tabla permite
 * exactamente el sesgo que MeritIA dice evitar —por genero, por origen, por
 * la universidad que se adivina en un apellido— justo mientras se compara a
 * las personas entre si.
 *
 * La primera version de este modulo devolvia nombre y correo en cada fila.
 * Estaba mal y contradecia el proposito del producto.
 *
 * COMO SE CONSTRUYE
 *
 * Hash del par vacante + candidato. Tiene tres propiedades que importan:
 *
 * 1. **Estable**: el mismo candidato es el mismo alias en toda la vacante, asi
 *    que el reclutador puede hablar de "el 3f8a2c" entre pantallas.
 * 2. **Distinto en cada vacante**, a proposito: si el alias fuera solo del
 *    candidato, dos empresas —o dos procesos de la misma— podrian cruzar sus
 *    tablas y seguir a una persona entre procesos. Con la vacante dentro, no.
 * 3. **No reversible**: del alias no se saca el identificador.
 *
 * Seis caracteres hexadecimales son 16,7 millones de valores. Con decenas de
 * candidatos por vacante, la probabilidad de que dos compartan alias es
 * despreciable, y dos alias iguales en la misma tabla serian confusos.
 */
export function aliasDeCandidato(idVacante: string, idCandidato: string): string {
  const huella = createHash('sha256').update(`${idVacante}:${idCandidato}`).digest('hex');
  return `Candidato ••••${huella.slice(0, 6)}`;
}
