import { describe, expect, it } from 'vitest';
import {
  EstadoVacante,
  admiteCambioDeEjercicios,
  admiteEdicion,
  puedeTransicionar,
} from './estado-vacante.js';

describe('ciclo de vida de una vacante', () => {
  describe('transiciones permitidas', () => {
    it('un borrador se publica o se descarta', () => {
      expect(puedeTransicionar(EstadoVacante.Borrador, EstadoVacante.Publicada)).toBe(true);
      expect(puedeTransicionar(EstadoVacante.Borrador, EstadoVacante.Cerrada)).toBe(true);
    });

    it('una publicada solo se cierra', () => {
      expect(puedeTransicionar(EstadoVacante.Publicada, EstadoVacante.Cerrada)).toBe(true);
    });
  });

  describe('transiciones prohibidas', () => {
    it('una cerrada no se reabre', () => {
      // Un proceso cerrado debe seguir siendo auditable tal como termino.
      expect(puedeTransicionar(EstadoVacante.Cerrada, EstadoVacante.Publicada)).toBe(false);
      expect(puedeTransicionar(EstadoVacante.Cerrada, EstadoVacante.Borrador)).toBe(false);
      expect(puedeTransicionar(EstadoVacante.Cerrada, EstadoVacante.Cerrada)).toBe(false);
    });

    it('una publicada no vuelve a borrador', () => {
      // Un candidato ya la vio y pudo empezar a resolver sus ejercicios.
      expect(puedeTransicionar(EstadoVacante.Publicada, EstadoVacante.Borrador)).toBe(false);
    });

    it('una publicada no se publica dos veces', () => {
      expect(puedeTransicionar(EstadoVacante.Publicada, EstadoVacante.Publicada)).toBe(false);
    });

    it('un borrador no transiciona a si mismo', () => {
      expect(puedeTransicionar(EstadoVacante.Borrador, EstadoVacante.Borrador)).toBe(false);
    });
  });

  describe('edicion', () => {
    it('se edita en borrador y publicada', () => {
      expect(admiteEdicion(EstadoVacante.Borrador)).toBe(true);
      expect(admiteEdicion(EstadoVacante.Publicada)).toBe(true);
    });

    it('no se edita una cerrada', () => {
      // Cambiarla alteraria el contexto de evaluaciones ya emitidas.
      expect(admiteEdicion(EstadoVacante.Cerrada)).toBe(false);
    });
  });

  describe('cambio de ejercicios', () => {
    it('solo en borrador', () => {
      expect(admiteCambioDeEjercicios(EstadoVacante.Borrador)).toBe(true);
    });

    it('NO en publicada, aunque la vacante si se pueda editar', () => {
      // Es la asimetria importante: el texto de una oferta publicada se puede
      // corregir, pero sus ejercicios no. Cambiarlos dejaria a dos candidatos
      // del mismo proceso resolviendo pruebas distintas, y comparar candidatos
      // con el mismo criterio es la razon de ser del producto.
      expect(admiteEdicion(EstadoVacante.Publicada)).toBe(true);
      expect(admiteCambioDeEjercicios(EstadoVacante.Publicada)).toBe(false);
    });

    it('NO en cerrada', () => {
      expect(admiteCambioDeEjercicios(EstadoVacante.Cerrada)).toBe(false);
    });
  });

  describe('el grafo completo', () => {
    it('desde cerrada no sale ninguna transicion', () => {
      for (const hacia of Object.values(EstadoVacante)) {
        expect(puedeTransicionar(EstadoVacante.Cerrada, hacia), `cerrada -> ${hacia}`).toBe(false);
      }
    });

    it('todo estado alcanza cerrada, salvo ella misma', () => {
      expect(puedeTransicionar(EstadoVacante.Borrador, EstadoVacante.Cerrada)).toBe(true);
      expect(puedeTransicionar(EstadoVacante.Publicada, EstadoVacante.Cerrada)).toBe(true);
    });
  });
});
