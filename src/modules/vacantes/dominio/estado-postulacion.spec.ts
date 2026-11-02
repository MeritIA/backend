import { describe, expect, it } from 'vitest';
import {
  EstadoPostulacion,
  LONGITUD_MINIMA_DEL_MOTIVO,
  puedeDecidirse,
  puedeTransicionar,
} from './estado-postulacion.js';

describe('estado de una postulacion', () => {
  it('una postulacion nueva se puede aceptar o rechazar', () => {
    expect(puedeTransicionar(EstadoPostulacion.EnRevision, EstadoPostulacion.Aceptada)).toBe(true);
    expect(puedeTransicionar(EstadoPostulacion.EnRevision, EstadoPostulacion.Rechazada)).toBe(true);
    expect(puedeDecidirse(EstadoPostulacion.EnRevision)).toBe(true);
  });

  describe('una decision sobre una persona no se reescribe', () => {
    it.each([EstadoPostulacion.Aceptada, EstadoPostulacion.Rechazada])(
      'desde "%s" no se va a ningun sitio',
      (desde) => {
        expect(puedeDecidirse(desde)).toBe(false);
        for (const hacia of Object.values(EstadoPostulacion)) {
          expect(puedeTransicionar(desde, hacia)).toBe(false);
        }
      },
    );

    it('aceptar no se deshace: dejaria a alguien a medio reto', () => {
      expect(puedeTransicionar(EstadoPostulacion.Aceptada, EstadoPostulacion.Rechazada)).toBe(
        false,
      );
    });

    it('rechazar no se deshace: el candidato ya recibio el motivo', () => {
      expect(puedeTransicionar(EstadoPostulacion.Rechazada, EstadoPostulacion.Aceptada)).toBe(
        false,
      );
    });
  });

  it('no hay vuelta a revision desde ningun estado', () => {
    for (const desde of Object.values(EstadoPostulacion)) {
      expect(puedeTransicionar(desde, EstadoPostulacion.EnRevision)).toBe(false);
    }
  });

  it('el motivo minimo deja fuera un "no" y cabe en la columna', () => {
    // Si alguien baja esto a 2, "no" vuelve a ser una respuesta valida y el
    // candidato se queda sin saber nada. Y por arriba tiene que caber en los
    // 500 de la columna.
    expect(LONGITUD_MINIMA_DEL_MOTIVO).toBeGreaterThanOrEqual(10);
    expect(LONGITUD_MINIMA_DEL_MOTIVO).toBeLessThan(500);
  });
});
