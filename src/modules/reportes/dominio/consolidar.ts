/**
 * Agregacion de resultados para el reporte (paquete 5.1).
 *
 * Todo lo de este archivo son funciones puras: entran notas, salen cifras. Sin
 * base de datos ni dependencias, porque es justo la parte donde un error no se
 * ve —un promedio mal hecho parece correcto— y hay que poder probarla a mano.
 */

/** Dos decimales. Mas precision en una nota de 0 a 100 no significa nada. */
const redondear = (n: number): number => Math.round(n * 100) / 100;

/** Lo minimo que el reporte necesita de una evaluacion. */
export interface EvaluacionParaReporte {
  readonly idEvaluacion: string;
  readonly idEntrega: string;
  readonly idCandidato: string;
  readonly idEjercicio: string;
  readonly notaFinal: number;
  readonly creadaEn: Date;
  readonly riesgoInyeccion: string;
  readonly criterios: readonly {
    readonly criterio: string;
    readonly puntaje: number;
    readonly escalaMaxima: number;
    readonly peso: number;
    readonly evidencia: string;
  }[];
}

/**
 * El criterio en el que al candidato le fue mejor.
 *
 * Es la columna "habilidad destacada" de la pantalla A06: lo que permite leer
 * una tabla de notas parecidas y ver que cada persona es fuerte en algo
 * distinto, que es justo el argumento del producto contra el CV.
 */
export interface HabilidadDestacada {
  criterio: string;
  /** Porcentaje logrado en ese criterio, de 0 a 100. */
  porcentajeLogrado: number;
  /** El peso que ese criterio tiene en la rubrica. */
  peso: number;
}

export interface FilaDeRanking {
  /** Empieza en 1. Dos candidatos empatados comparten posicion. */
  posicion: number;
  idCandidato: string;
  notaFinal: number;
  idEntrega: string;
  idEvaluacion: string;
  evaluadaEn: Date;
  /** Cuantas entregas suyas se han evaluado en esta vacante. */
  intentosEvaluados: number;
  /** Del intento que puntua. Se le muestra al reclutador, nunca al candidato. */
  riesgoInyeccion: string;
  /**
   * Sale del MISMO intento que da la nota, no del promedio de sus intentos.
   *
   * La fila entera describe un intento concreto —su nota, su entrega, su
   * evidencia—, y mezclar aqui un promedio de otros intentos haria que el
   * reclutador no pudiera comprobar la columna contra el detalle. `null` si esa
   * evaluacion no trae desglose por criterio.
   */
  habilidadDestacada: HabilidadDestacada | null;
}

/**
 * El criterio con mayor porcentaje logrado de una evaluacion.
 *
 * Porcentaje y no puntaje crudo: dos criterios con escalas distintas no se
 * pueden comparar en bruto, y "8 de 20" no es mejor que "4 de 5".
 *
 * Desempates, en orden: el de mayor peso en la rubrica —destacar en algo que
 * pesa el 40 % dice mas que destacar en algo que pesa el 5 %— y luego el nombre,
 * para que la columna no baile entre dos consultas de los mismos datos.
 */
export function habilidadDestacadaDe(evaluacion: EvaluacionParaReporte): HabilidadDestacada | null {
  let mejor: HabilidadDestacada | null = null;

  for (const c of evaluacion.criterios) {
    const porcentajeLogrado =
      c.escalaMaxima > 0 ? redondear((c.puntaje / c.escalaMaxima) * 100) : 0;
    const candidata = { criterio: c.criterio, porcentajeLogrado, peso: c.peso };

    if (mejor === null || esMejorHabilidad(candidata, mejor)) mejor = candidata;
  }

  return mejor;
}

function esMejorHabilidad(a: HabilidadDestacada, b: HabilidadDestacada): boolean {
  if (a.porcentajeLogrado !== b.porcentajeLogrado) return a.porcentajeLogrado > b.porcentajeLogrado;
  if (a.peso !== b.peso) return a.peso > b.peso;
  return a.criterio.localeCompare(b.criterio) < 0;
}

/**
 * Una fila por candidato, de mayor a menor nota.
 *
 * CUAL INTENTO PUNTUA: el mejor.
 *
 * Ningun documento lo define —queda anotado para la Declaracion de Alcance—, y
 * la decision no es neutra. Se toma el mejor porque los reintentos existen para
 * que el candidato muestre lo que sabe: puntuar el ultimo convertiria cada
 * intento extra en un riesgo, y el candidato dejaria de usarlos. El detalle por
 * candidato devuelve TODOS los intentos, asi que nada queda escondido: el
 * reclutador ve de donde sale la nota del ranking.
 *
 * Empates: misma nota, misma posicion, y la siguiente posicion salta. Con notas
 * iguales desempata quien evaluo antes, para que el orden no baile entre dos
 * llamadas.
 */
export function rankingDeCandidatos(
  evaluaciones: readonly EvaluacionParaReporte[],
): FilaDeRanking[] {
  const porCandidato = new Map<string, EvaluacionParaReporte[]>();
  for (const e of evaluaciones) {
    const suyas = porCandidato.get(e.idCandidato) ?? [];
    suyas.push(e);
    porCandidato.set(e.idCandidato, suyas);
  }

  const mejores = [...porCandidato.values()].map((suyas) => {
    const mejor = suyas.reduce((a, b) => {
      if (b.notaFinal !== a.notaFinal) return b.notaFinal > a.notaFinal ? b : a;
      return b.creadaEn.getTime() < a.creadaEn.getTime() ? b : a;
    });
    return { mejor, intentos: suyas.length };
  });

  mejores.sort((a, b) => {
    if (b.mejor.notaFinal !== a.mejor.notaFinal) return b.mejor.notaFinal - a.mejor.notaFinal;
    const porFecha = a.mejor.creadaEn.getTime() - b.mejor.creadaEn.getTime();
    // Tercer criterio el id: sin el, dos evaluaciones del mismo instante
    // podrian salir en un orden distinto en cada consulta.
    return porFecha !== 0 ? porFecha : a.mejor.idCandidato.localeCompare(b.mejor.idCandidato);
  });

  let posicion = 0;
  let notaAnterior = Number.NaN;
  return mejores.map(({ mejor, intentos }, indice) => {
    if (mejor.notaFinal !== notaAnterior) {
      posicion = indice + 1;
      notaAnterior = mejor.notaFinal;
    }
    return {
      posicion,
      idCandidato: mejor.idCandidato,
      notaFinal: mejor.notaFinal,
      idEntrega: mejor.idEntrega,
      idEvaluacion: mejor.idEvaluacion,
      evaluadaEn: mejor.creadaEn,
      intentosEvaluados: intentos,
      riesgoInyeccion: mejor.riesgoInyeccion,
      habilidadDestacada: habilidadDestacadaDe(mejor),
    };
  });
}

export interface PromedioDeCriterio {
  criterio: string;
  /** Promedio del porcentaje logrado (puntaje sobre escala), de 0 a 100. */
  promedioLogrado: number;
  peso: number;
  evaluaciones: number;
}

export interface ResumenDeVacante {
  candidatosEvaluados: number;
  entregasEvaluadas: number;
  entregasEnProceso: number;
  entregasFallidas: number;
  notaPromedio: number | null;
  notaMediana: number | null;
  notaMaxima: number | null;
  notaMinima: number | null;
  /** Donde se cae la gente. Ordenado del criterio mas flojo al mas logrado. */
  porCriterio: PromedioDeCriterio[];
  entregasConRiesgoAlto: number;
}

export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 1 ? orden[medio] : redondear((orden[medio - 1] + orden[medio]) / 2);
}

/**
 * Las cifras consolidadas de la vacante.
 *
 * El promedio se calcula sobre el ranking —una nota por candidato— y no sobre
 * todas las evaluaciones: si no, quien entrego cinco veces pesaria cinco veces
 * en el promedio de la vacante.
 *
 * Los conteos de entregas en proceso y fallidas vienen del modulo de entregas,
 * porque son justo lo que el ranking no puede mostrar: el reclutador necesita
 * saber si el ranking esta completo o si falta gente por evaluar.
 */
export function resumenDeVacante(
  ranking: readonly FilaDeRanking[],
  evaluaciones: readonly EvaluacionParaReporte[],
  conteosDeEntregas: { enProceso: number; fallidas: number },
): ResumenDeVacante {
  const notas = ranking.map((f) => f.notaFinal);
  const suma = notas.reduce((a, b) => a + b, 0);

  const acumulado = new Map<string, { logrado: number; peso: number; veces: number }>();
  for (const e of evaluaciones) {
    for (const c of e.criterios) {
      const previo = acumulado.get(c.criterio) ?? { logrado: 0, peso: c.peso, veces: 0 };
      // Porcentaje logrado y no el puntaje crudo: dos criterios con escalas
      // distintas no se pueden comparar en bruto.
      const logrado = c.escalaMaxima > 0 ? (c.puntaje / c.escalaMaxima) * 100 : 0;
      acumulado.set(c.criterio, {
        logrado: previo.logrado + logrado,
        peso: c.peso,
        veces: previo.veces + 1,
      });
    }
  }

  const porCriterio = [...acumulado.entries()]
    .map(([criterio, a]) => ({
      criterio,
      promedioLogrado: redondear(a.logrado / a.veces),
      peso: a.peso,
      evaluaciones: a.veces,
    }))
    .sort((a, b) => a.promedioLogrado - b.promedioLogrado || a.criterio.localeCompare(b.criterio));

  return {
    candidatosEvaluados: ranking.length,
    entregasEvaluadas: evaluaciones.length,
    entregasEnProceso: conteosDeEntregas.enProceso,
    entregasFallidas: conteosDeEntregas.fallidas,
    notaPromedio: notas.length > 0 ? redondear(suma / notas.length) : null,
    notaMediana: mediana(notas),
    notaMaxima: notas.length > 0 ? Math.max(...notas) : null,
    notaMinima: notas.length > 0 ? Math.min(...notas) : null,
    porCriterio,
    entregasConRiesgoAlto: evaluaciones.filter((e) => e.riesgoInyeccion === 'alto').length,
  };
}
