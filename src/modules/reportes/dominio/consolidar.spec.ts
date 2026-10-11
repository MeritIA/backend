import { describe, expect, it } from 'vitest';
import {
  mediana,
  rankingDeCandidatos,
  resumenDeVacante,
  type EvaluacionParaReporte,
} from './consolidar.js';

let contador = 0;

/** Una evaluacion con lo justo para el reporte. */
function evaluacion(
  idCandidato: string,
  notaFinal: number,
  opciones: {
    creadaEn?: Date;
    criterios?: { criterio: string; puntaje: number; escalaMaxima: number; peso: number }[];
    riesgoInyeccion?: string;
  } = {},
): EvaluacionParaReporte {
  contador += 1;
  return {
    idEvaluacion: `ev-${contador}`,
    idEntrega: `en-${contador}`,
    idCandidato,
    idEjercicio: 'ej-1',
    notaFinal,
    creadaEn: opciones.creadaEn ?? new Date(`2026-10-0${(contador % 9) + 1}T10:00:00Z`),
    riesgoInyeccion: opciones.riesgoInyeccion ?? 'ninguno',
    criterios: (opciones.criterios ?? []).map((c) => ({ ...c, evidencia: 'porque si' })),
  };
}

describe('ranking de candidatos', () => {
  it('ordena de mayor a menor nota y numera desde 1', () => {
    const filas = rankingDeCandidatos([
      evaluacion('ana', 55),
      evaluacion('luis', 90),
      evaluacion('sara', 72),
    ]);

    expect(filas.map((f) => [f.posicion, f.idCandidato])).toEqual([
      [1, 'luis'],
      [2, 'sara'],
      [3, 'ana'],
    ]);
  });

  describe('CRITERIO: una fila por candidato', () => {
    it('con varios intentos puntua el mejor, y dice cuantos fueron', () => {
      const filas = rankingDeCandidatos([
        evaluacion('ana', 40, { creadaEn: new Date('2026-10-01T10:00:00Z') }),
        evaluacion('ana', 85, { creadaEn: new Date('2026-10-02T10:00:00Z') }),
        evaluacion('ana', 60, { creadaEn: new Date('2026-10-03T10:00:00Z') }),
      ]);

      expect(filas).toHaveLength(1);
      expect(filas[0].notaFinal).toBe(85);
      expect(filas[0].intentosEvaluados).toBe(3);
    });

    it('la fila apunta a la entrega del intento que puntua, no a la ultima', () => {
      // Sin esto, el reclutador abriria la entrega equivocada al revisar la
      // nota del ranking.
      const mejor = evaluacion('ana', 85, { creadaEn: new Date('2026-10-02T10:00:00Z') });
      const ultima = evaluacion('ana', 60, { creadaEn: new Date('2026-10-05T10:00:00Z') });

      const [fila] = rankingDeCandidatos([mejor, ultima]);

      expect(fila.idEntrega).toBe(mejor.idEntrega);
      expect(fila.idEvaluacion).toBe(mejor.idEvaluacion);
      expect(fila.evaluadaEn).toEqual(mejor.creadaEn);
    });

    it('con dos intentos de la misma nota puntua el primero', () => {
      const primero = evaluacion('ana', 70, { creadaEn: new Date('2026-10-01T10:00:00Z') });
      const segundo = evaluacion('ana', 70, { creadaEn: new Date('2026-10-04T10:00:00Z') });

      // En los dos ordenes, para que el resultado no dependa de como vengan de
      // la base de datos.
      expect(rankingDeCandidatos([segundo, primero])[0].idEntrega).toBe(primero.idEntrega);
      expect(rankingDeCandidatos([primero, segundo])[0].idEntrega).toBe(primero.idEntrega);
    });
  });

  describe('empates', () => {
    it('misma nota, misma posicion, y la siguiente salta', () => {
      const filas = rankingDeCandidatos([
        evaluacion('ana', 80),
        evaluacion('luis', 80),
        evaluacion('sara', 50),
      ]);

      expect(filas.map((f) => f.posicion)).toEqual([1, 1, 3]);
    });

    it('el orden no cambia entre dos llamadas con los mismos datos', () => {
      // Dos notas iguales en el mismo instante: sin un tercer criterio de
      // desempate, el ranking bailaria y el reclutador veria otro orden al
      // recargar.
      const momento = new Date('2026-10-01T10:00:00Z');
      const evaluaciones = [
        evaluacion('zoe', 80, { creadaEn: momento }),
        evaluacion('ana', 80, { creadaEn: momento }),
      ];

      const primera = rankingDeCandidatos(evaluaciones).map((f) => f.idCandidato);
      const segunda = rankingDeCandidatos([...evaluaciones].reverse()).map((f) => f.idCandidato);

      expect(primera).toEqual(segunda);
    });
  });

  it('sin evaluaciones el ranking esta vacio, no falla', () => {
    expect(rankingDeCandidatos([])).toEqual([]);
  });
});

describe('mediana', () => {
  it('con un numero impar de notas es la del medio', () => {
    expect(mediana([10, 90, 50])).toBe(50);
  });

  it('con un numero par es el promedio de las dos del medio', () => {
    expect(mediana([10, 40, 60, 90])).toBe(50);
  });

  it('sin notas es nula, que no es lo mismo que cero', () => {
    expect(mediana([])).toBeNull();
  });
});

describe('resumen de la vacante', () => {
  const sinEntregasPendientes = { enProceso: 0, fallidas: 0 };

  it('cuenta candidatos y entregas por separado', () => {
    const evaluaciones = [evaluacion('ana', 40), evaluacion('ana', 80), evaluacion('luis', 60)];
    const resumen = resumenDeVacante(
      rankingDeCandidatos(evaluaciones),
      evaluaciones,
      sinEntregasPendientes,
    );

    expect(resumen.candidatosEvaluados).toBe(2);
    expect(resumen.entregasEvaluadas).toBe(3);
  });

  it('el promedio es por candidato: cinco intentos no pesan cinco veces', () => {
    // Ana entrego tres veces y Luis una. Si el promedio se calculara sobre las
    // evaluaciones seria 63,33; sobre los candidatos es 70, que es lo que
    // significa "nota promedio de la vacante".
    const evaluaciones = [
      evaluacion('ana', 80),
      evaluacion('ana', 70),
      evaluacion('ana', 60),
      evaluacion('luis', 60),
    ];
    const resumen = resumenDeVacante(
      rankingDeCandidatos(evaluaciones),
      evaluaciones,
      sinEntregasPendientes,
    );

    expect(resumen.notaPromedio).toBe(70);
    expect(resumen.notaMaxima).toBe(80);
    expect(resumen.notaMinima).toBe(60);
  });

  it('redondea a dos decimales', () => {
    const evaluaciones = [evaluacion('ana', 10), evaluacion('luis', 10), evaluacion('sara', 11)];
    const resumen = resumenDeVacante(
      rankingDeCandidatos(evaluaciones),
      evaluaciones,
      sinEntregasPendientes,
    );

    expect(resumen.notaPromedio).toBe(10.33);
  });

  it('sin ninguna evaluacion las notas son nulas y no cero', () => {
    const resumen = resumenDeVacante([], [], { enProceso: 4, fallidas: 1 });

    expect(resumen.notaPromedio).toBeNull();
    expect(resumen.notaMediana).toBeNull();
    expect(resumen.candidatosEvaluados).toBe(0);
    // Y aun asi informa de que hay cinco entregas esperando: el ranking vacio
    // no significa que nadie haya entregado.
    expect(resumen.entregasEnProceso).toBe(4);
    expect(resumen.entregasFallidas).toBe(1);
  });

  describe('promedio por criterio', () => {
    it('compara en porcentaje logrado, no en puntos crudos', () => {
      // Dos criterios con escalas distintas: 3 de 5 es 60 %, y 8 de 10 es 80 %.
      // En puntos crudos el segundo parece peor de lo que es.
      const evaluaciones = [
        evaluacion('ana', 70, {
          criterios: [
            { criterio: 'Correccion', puntaje: 3, escalaMaxima: 5, peso: 70 },
            { criterio: 'Estilo', puntaje: 8, escalaMaxima: 10, peso: 30 },
          ],
        }),
      ];
      const resumen = resumenDeVacante(
        rankingDeCandidatos(evaluaciones),
        evaluaciones,
        sinEntregasPendientes,
      );

      expect(resumen.porCriterio).toEqual([
        { criterio: 'Correccion', promedioLogrado: 60, peso: 70, evaluaciones: 1 },
        { criterio: 'Estilo', promedioLogrado: 80, peso: 30, evaluaciones: 1 },
      ]);
    });

    it('ordena del criterio mas flojo al mas logrado: ahi esta el hallazgo', () => {
      const evaluaciones = [
        evaluacion('ana', 70, {
          criterios: [
            { criterio: 'Bien', puntaje: 5, escalaMaxima: 5, peso: 50 },
            { criterio: 'Flojo', puntaje: 1, escalaMaxima: 5, peso: 50 },
          ],
        }),
      ];
      const resumen = resumenDeVacante(
        rankingDeCandidatos(evaluaciones),
        evaluaciones,
        sinEntregasPendientes,
      );

      expect(resumen.porCriterio.map((c) => c.criterio)).toEqual(['Flojo', 'Bien']);
    });

    it('dos criterios igual de logrados se ordenan por nombre, no al azar', () => {
      const evaluaciones = [
        evaluacion('ana', 70, {
          criterios: [
            { criterio: 'Zeta', puntaje: 3, escalaMaxima: 5, peso: 50 },
            { criterio: 'Alfa', puntaje: 3, escalaMaxima: 5, peso: 50 },
          ],
        }),
      ];
      const resumen = resumenDeVacante(
        rankingDeCandidatos(evaluaciones),
        evaluaciones,
        sinEntregasPendientes,
      );

      expect(resumen.porCriterio.map((c) => c.criterio)).toEqual(['Alfa', 'Zeta']);
    });

    it('promedia el mismo criterio entre varios candidatos', () => {
      const criterios = (puntaje: number) => [
        { criterio: 'Correccion', puntaje, escalaMaxima: 10, peso: 100 },
      ];
      const evaluaciones = [
        evaluacion('ana', 50, { criterios: criterios(4) }),
        evaluacion('luis', 80, { criterios: criterios(8) }),
      ];
      const resumen = resumenDeVacante(
        rankingDeCandidatos(evaluaciones),
        evaluaciones,
        sinEntregasPendientes,
      );

      expect(resumen.porCriterio[0]).toMatchObject({ promedioLogrado: 60, evaluaciones: 2 });
    });

    it('una escala maxima en cero no rompe el reporte con una division', () => {
      const evaluaciones = [
        evaluacion('ana', 0, {
          criterios: [{ criterio: 'Raro', puntaje: 0, escalaMaxima: 0, peso: 100 }],
        }),
      ];
      const resumen = resumenDeVacante(
        rankingDeCandidatos(evaluaciones),
        evaluaciones,
        sinEntregasPendientes,
      );

      expect(resumen.porCriterio[0].promedioLogrado).toBe(0);
    });
  });

  it('cuenta las entregas marcadas con riesgo alto de inyeccion', () => {
    const evaluaciones = [
      evaluacion('ana', 70, { riesgoInyeccion: 'alto' }),
      evaluacion('luis', 60, { riesgoInyeccion: 'bajo' }),
      evaluacion('sara', 50, { riesgoInyeccion: 'alto' }),
    ];
    const resumen = resumenDeVacante(
      rankingDeCandidatos(evaluaciones),
      evaluaciones,
      sinEntregasPendientes,
    );

    expect(resumen.entregasConRiesgoAlto).toBe(2);
  });
});
