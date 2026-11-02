import { describe, expect, it } from 'vitest';
import { EstadoVacante } from './estado-vacante.js';
import {
  decidirInvitacionAutomatica,
  type PoliticaDeInvitacion,
} from './politica-de-invitacion.js';

const CON_UMBRAL: PoliticaDeInvitacion = { activa: true, umbral: 70, cupo: null };
const ABIERTA: PoliticaDeInvitacion = { activa: true, umbral: null, cupo: null };

const decidir = (
  politica: PoliticaDeInvitacion,
  afinidad: number | null,
  emitidas = 0,
  estado = EstadoVacante.Publicada,
) => decidirInvitacionAutomatica(politica, estado, afinidad, emitidas);

describe('politica de invitacion automatica', () => {
  describe('LA REGLA QUE LO HACE SEGURO: solo dice si, nunca no', () => {
    it('quien no alcanza el umbral NO se rechaza: se deja para una persona', () => {
      const d = decidir(CON_UMBRAL, 40);
      expect(d.acepta).toBe(false);
      // No hay ningun valor de retorno que signifique "rechazado". El unico
      // desenlace negativo es "no me ocupo", y eso deja la postulacion en
      // revision, exactamente donde estaria sin esta funcion.
      expect(d).toMatchObject({ motivo: 'bajo_el_umbral' });
    });

    it('ningun motivo de los posibles significa rechazar', () => {
      const motivos = [
        decidir({ ...CON_UMBRAL, activa: false }, 90),
        decidir(CON_UMBRAL, null),
        decidir(CON_UMBRAL, 10),
        decidir({ ...CON_UMBRAL, cupo: 0 }, 90),
        decidir(CON_UMBRAL, 90, 0, EstadoVacante.Cerrada),
      ];
      for (const d of motivos) {
        expect(d.acepta).toBe(false);
        expect(JSON.stringify(d)).not.toMatch(/rechaz/i);
      }
    });
  });

  describe('sin evidencia se abstiene, y eso salva a quien empieza', () => {
    it('afinidad null con umbral no entra, pero tampoco se descarta', () => {
      // La trampa del principiante: sin perfil no entras, sin entrar no haces
      // pruebas, sin pruebas no tienes perfil. Abstenerse la rompe, porque una
      // persona sigue pudiendo invitarlo.
      expect(decidir(CON_UMBRAL, null)).toMatchObject({
        acepta: false,
        motivo: 'sin_evidencia',
      });
    });

    it('en modo abierto SI entra, porque ese modo no mira el perfil', () => {
      const d = decidir(ABIERTA, null);
      expect(d.acepta).toBe(true);
      expect(d).toMatchObject({ afinidad: null });
    });
  });

  describe('con umbral', () => {
    it('por encima entra', () => {
      expect(decidir(CON_UMBRAL, 85)).toMatchObject({ acepta: true, afinidad: 85 });
    });

    it('justo en el umbral entra: el minimo incluye su valor', () => {
      expect(decidir(CON_UMBRAL, 70).acepta).toBe(true);
    });

    it('justo por debajo no', () => {
      expect(decidir(CON_UMBRAL, 69.9).acepta).toBe(false);
    });
  });

  describe('el cupo limita lo automatico y nada mas', () => {
    it('con el cupo lleno no entra aunque la afinidad sea perfecta', () => {
      expect(decidir({ ...CON_UMBRAL, cupo: 3 }, 100, 3)).toMatchObject({
        acepta: false,
        motivo: 'cupo_agotado',
      });
    });

    it('por debajo del cupo entra', () => {
      expect(decidir({ ...CON_UMBRAL, cupo: 3 }, 100, 2).acepta).toBe(true);
    });

    it('cupo cero es apagarlo de hecho, y se dice con su motivo', () => {
      expect(decidir({ ...ABIERTA, cupo: 0 }, 100)).toMatchObject({
        acepta: false,
        motivo: 'cupo_agotado',
      });
    });

    it('sin cupo no hay tope', () => {
      expect(decidir(ABIERTA, 50, 10_000).acepta).toBe(true);
    });
  });

  describe('el estado de la vacante', () => {
    it.each([EstadoVacante.Borrador, EstadoVacante.Cerrada])(
      'en "%s" no se acepta: seria dar un reto que no se va a evaluar',
      (estado) => {
        expect(decidir(ABIERTA, 100, 0, estado)).toMatchObject({
          acepta: false,
          motivo: 'vacante_no_publicada',
        });
      },
    );
  });

  it('con la politica apagada no decide nada, aunque todo lo demas cuadre', () => {
    expect(decidir({ activa: false, umbral: null, cupo: null }, 100)).toMatchObject({
      acepta: false,
      motivo: 'politica_apagada',
    });
  });
});
