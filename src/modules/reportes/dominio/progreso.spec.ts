import { describe, expect, it } from 'vitest';
import { progresoDe, type VacanteParaProgreso } from './progreso.js';

function vacante(parcial: Partial<VacanteParaProgreso> = {}): VacanteParaProgreso {
  return {
    id: 'v1',
    titulo: 'Desarrollador backend junior',
    publicadaEn: new Date('2026-10-01T00:00:00.000Z'),
    cierreEstimado: null,
    finalistasAEvaluar: null,
    invitados: 10,
    ...parcial,
  };
}

describe('progresoDe', () => {
  it('el avance es el porcentaje de invitados ya evaluados', () => {
    const p = progresoDe(vacante({ invitados: 8 }), { v1: 5 }, { v1: 2 });

    expect(p.invitados).toBe(8);
    expect(p.conEntrega).toBe(5);
    expect(p.evaluados).toBe(2);
    expect(p.avance).toBe(25);
  });

  it('sin nadie invitado el avance es null y no cero', () => {
    const p = progresoDe(vacante({ invitados: 0 }), {}, {});

    // Cero diria "parado"; null dice "no ha empezado", que es lo que pasa. La
    // pantalla necesita distinguirlos para pedir que se invite a alguien.
    expect(p.avance).toBeNull();
    expect(p.invitados).toBe(0);
  });

  it('con gente invitada y nadie evaluado el avance es cero, no null', () => {
    const p = progresoDe(vacante({ invitados: 4 }), { v1: 1 }, {});

    expect(p.avance).toBe(0);
  });

  it('la vacante que no aparece en los conteos cuenta cero, no falla', () => {
    const p = progresoDe(vacante({ id: 'recien-publicada' }), { otra: 3 }, { otra: 3 });

    expect(p.conEntrega).toBe(0);
    expect(p.evaluados).toBe(0);
    expect(p.avance).toBe(0);
  });

  it('solo llega a 100 cuando no falta nadie', () => {
    expect(progresoDe(vacante({ invitados: 10 }), {}, { v1: 10 }).avance).toBe(100);

    // 198 de 199 redondea a 100 y el reclutador cerraria creyendo que termino.
    expect(progresoDe(vacante({ invitados: 199 }), {}, { v1: 198 }).avance).toBe(99);
  });

  it('el plan viaja aparte y los evaluados pueden superarlo', () => {
    const p = progresoDe(vacante({ invitados: 12, finalistasAEvaluar: 10 }), {}, { v1: 12 });

    // El plan es un plan: ni limita el avance ni lo divide.
    expect(p.finalistasAEvaluar).toBe(10);
    expect(p.evaluados).toBe(12);
    expect(p.avance).toBe(100);
  });

  it('cambiar el plan a mitad del proceso no mueve el avance', () => {
    const conPlanBajo = progresoDe(
      vacante({ invitados: 10, finalistasAEvaluar: 3 }),
      {},
      { v1: 5 },
    );
    const conPlanAlto = progresoDe(
      vacante({ invitados: 10, finalistasAEvaluar: 30 }),
      {},
      { v1: 5 },
    );

    // Esta es la razon de no dividir por el plan: la barra no debe retroceder
    // porque el reclutador cambio de idea sobre cuanta gente quiere evaluar.
    expect(conPlanBajo.avance).toBe(conPlanAlto.avance);
    expect(conPlanBajo.avance).toBe(50);
  });

  it('no inventa el estimado de cierre ni lo rechaza por estar en el pasado', () => {
    const pasado = new Date('2020-01-01T00:00:00.000Z');
    const p = progresoDe(vacante({ cierreEstimado: pasado }), {}, {});

    // Una vacante vencida es un hecho que el panel tiene que poder mostrar.
    expect(p.cierreEstimado).toEqual(pasado);
    expect(progresoDe(vacante(), {}, {}).cierreEstimado).toBeNull();
  });
});
