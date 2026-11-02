import { normalizarHabilidad, type NivelDeHabilidad } from '../../evaluacion/index.js';

/**
 * El % de afinidad entre un candidato y una vacante (B13, A04).
 *
 * QUE COMPARA
 *
 * Lo que la vacante EXIGE --los criterios de las rubricas de sus ejercicios,
 * con sus pesos-- contra lo que el candidato ha DEMOSTRADO --su nivel medio en
 * cada criterio sobre el que alguna vez se le califico--.
 *
 * No compara un CV con una descripcion de puesto. Eso es importante: la
 * afinidad de MeritIA sale de pruebas resueltas y calificadas contra una
 * rubrica, no de lo que alguien escribio sobre si mismo. Es la unica version de
 * "afinidad" que es coherente con el producto.
 *
 * LA MEDIA SE PONDERA SOLO SOBRE LO QUE TIENE EVIDENCIA
 *
 * Es la decision que mas cambia el numero, asi que va explicada. Si un criterio
 * de la rubrica nunca se le califico al candidato, NO cuenta como cero: cuenta
 * como que no se sabe. Lo contrario confundiria "lo hace mal" con "nunca se le
 * pregunto", que son cosas distintas y la segunda no es culpa de nadie.
 *
 * El precio de esa decision es que un candidato con evidencia en UN solo
 * criterio de cuatro puede salir con un 90 %. Por eso el resultado nunca viaja
 * solo: lleva `cobertura`, que dice sobre cuanto peso de la rubrica hay
 * evidencia. Un 90 % con cobertura del 25 % se lee distinto, y la pantalla
 * tiene los dos numeros para decirlo.
 *
 * SIN EVIDENCIA NO HAY NUMERO: `null`, NO CERO
 *
 * Un candidato que no ha hecho ninguna prueba no tiene un 0 % de afinidad:
 * tiene afinidad desconocida. Un cero diria "no encajas" a quien todavia no ha
 * tenido oportunidad de demostrar nada, que es lo contrario de lo que el
 * producto quiere decir. Es la misma distincion que ya existe en el panel de la
 * empresa entre `avance === null` y `avance === 0`.
 */

/** Un criterio que la vacante exige, con su peso ya normalizado a 0..100. */
export interface CriterioExigido {
  readonly nombre: string;
  readonly peso: number;
}

/** Como le fue a un criterio en el calculo, para poder explicar el numero. */
export interface CriterioDeAfinidad {
  readonly nombre: string;
  readonly peso: number;
  /** Nivel demostrado, 0 a 100, o null si nunca se le califico este criterio. */
  readonly nivel: number | null;
  /** Cuantas calificaciones lo sostienen. */
  readonly veces: number;
}

export interface Afinidad {
  /** 0 a 100, o null si no hay ninguna evidencia sobre lo que la vacante pide. */
  readonly porcentaje: number | null;
  /** Cuanto peso de la rubrica tiene evidencia, 0 a 100. */
  readonly cobertura: number;
  /** El desglose, para que el numero se pueda discutir en vez de creer. */
  readonly criterios: readonly CriterioDeAfinidad[];
}

/** Lo que se devuelve cuando la vacante no exige nada que se pueda comparar. */
const SIN_RUBRICA: Afinidad = { porcentaje: null, cobertura: 0, criterios: [] };

/**
 * Une los criterios de varios ejercicios en una sola lista de exigencias.
 *
 * Los pesos de UNA rubrica suman 100. Si la vacante tiene tres ejercicios,
 * sumarian 300, asi que se reparten: cada ejercicio aporta lo mismo al total.
 *
 * POR QUE A PARTES IGUALES Y NO POR NUMERO DE CRITERIOS
 *
 * Un ejercicio con ocho criterios no es mas importante que uno con dos: es mas
 * detallado. Repartir por criterios haria que detallar una rubrica le diera mas
 * peso a ese ejercicio sin que nadie lo decidiera. La vacante no dice cuanto
 * vale cada ejercicio --no hay campo para eso-- asi que valen lo mismo, y queda
 * escrito como lo que es: un supuesto, no un dato.
 *
 * Un criterio repetido en dos ejercicios suma sus pesos: la vacante lo pide dos
 * veces, asi que importa el doble.
 */
export function exigenciasDe(
  rubricas: ReadonlyArray<readonly CriterioExigido[]>,
): CriterioExigido[] {
  const conCriterios = rubricas.filter((r) => r.length > 0);
  if (conCriterios.length === 0) return [];

  const porHabilidad = new Map<string, CriterioExigido>();
  const porEjercicio = 1 / conCriterios.length;

  for (const rubrica of conCriterios) {
    for (const criterio of rubrica) {
      const clave = normalizarHabilidad(criterio.nombre);
      const previo = porHabilidad.get(clave);
      const peso = criterio.peso * porEjercicio;
      porHabilidad.set(clave, {
        nombre: previo?.nombre ?? criterio.nombre,
        peso: (previo?.peso ?? 0) + peso,
      });
    }
  }

  return [...porHabilidad.values()];
}

/**
 * El calculo. Puro: ni base de datos ni red, para que se pueda probar entero.
 */
export function calcularAfinidad(
  exigencias: readonly CriterioExigido[],
  perfil: ReadonlyMap<string, NivelDeHabilidad>,
): Afinidad {
  if (exigencias.length === 0) return SIN_RUBRICA;

  const pesoTotal = exigencias.reduce((s, c) => s + c.peso, 0);
  if (pesoTotal <= 0) return SIN_RUBRICA;

  const criterios: CriterioDeAfinidad[] = exigencias.map((exigencia) => {
    const demostrado = perfil.get(normalizarHabilidad(exigencia.nombre));
    return {
      nombre: exigencia.nombre,
      peso: redondear(exigencia.peso),
      nivel: demostrado ? redondear(demostrado.nivel * 100) : null,
      veces: demostrado?.veces ?? 0,
    };
  });

  const conEvidencia = criterios.filter((c) => c.nivel !== null);
  const pesoConEvidencia = conEvidencia.reduce((s, c) => s + c.peso, 0);

  // Ni una sola prueba sobre lo que esta vacante pide: no se sabe, no es cero.
  if (pesoConEvidencia <= 0) {
    return { porcentaje: null, cobertura: 0, criterios };
  }

  const logrado = conEvidencia.reduce((s, c) => s + c.peso * (c.nivel ?? 0), 0);

  return {
    porcentaje: redondear(logrado / pesoConEvidencia),
    cobertura: redondear((pesoConEvidencia / pesoTotal) * 100),
    criterios,
  };
}

/** Un decimal: el numero se ensena en una pantalla, no se encadena en cuentas. */
function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}
