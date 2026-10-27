import { describe, expect, it } from 'vitest';
import { aliasDeCandidato } from './alias.js';

const VACANTE = '11111111-1111-4111-8111-111111111111';
const OTRA_VACANTE = '22222222-2222-4222-8222-222222222222';
const CANDIDATO = '33333333-3333-4333-8333-333333333333';

describe('alias del candidato en el ranking', () => {
  it('es estable: el mismo candidato en la misma vacante da el mismo alias', () => {
    expect(aliasDeCandidato(VACANTE, CANDIDATO)).toBe(aliasDeCandidato(VACANTE, CANDIDATO));
  });

  it('CAMBIA entre vacantes, para que nadie siga a una persona entre procesos', () => {
    // Si el alias fuera solo del candidato, dos empresas podrian cruzar sus
    // tablas y reconstruir su historial. Esta prueba es la que lo impide.
    expect(aliasDeCandidato(VACANTE, CANDIDATO)).not.toBe(
      aliasDeCandidato(OTRA_VACANTE, CANDIDATO),
    );
  });

  it('no deja ver el identificador del candidato', () => {
    const alias = aliasDeCandidato(VACANTE, CANDIDATO);
    expect(alias).not.toContain(CANDIDATO);
    expect(alias).not.toContain(CANDIDATO.slice(0, 8));
  });

  it('dos candidatos distintos no comparten alias', () => {
    const otro = '44444444-4444-4444-8444-444444444444';
    expect(aliasDeCandidato(VACANTE, CANDIDATO)).not.toBe(aliasDeCandidato(VACANTE, otro));
  });

  it('tiene la forma que espera la pantalla', () => {
    expect(aliasDeCandidato(VACANTE, CANDIDATO)).toMatch(/^Candidato ••••[0-9a-f]{6}$/);
  });
});
