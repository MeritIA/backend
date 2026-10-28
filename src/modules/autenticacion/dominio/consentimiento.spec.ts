import { describe, expect, it } from 'vitest';
import {
  CATALOGO,
  permisoDelCatalogo,
  TipoDeConsentimiento,
  TIPOS_DE_CONSENTIMIENTO,
  VERSION_DEL_AVISO,
} from './consentimiento.js';

/**
 * El catalogo es una transcripcion de dos pantallas, no una invencion. Estas
 * pruebas fijan lo que esas pantallas dicen, para que cambiarlo tenga que ser
 * una decision y no un descuido.
 */
describe('catalogo de consentimientos', () => {
  it('tiene un permiso por cada tipo, sin sobrar ni faltar', () => {
    expect(CATALOGO).toHaveLength(TIPOS_DE_CONSENTIMIENTO.length);
    for (const tipo of TIPOS_DE_CONSENTIMIENTO) {
      expect(permisoDelCatalogo(tipo).tipo).toBe(tipo);
    }
  });

  it('todos llevan el texto que el titular acepta', () => {
    for (const permiso of CATALOGO) {
      expect(permiso.titulo.length).toBeGreaterThan(0);
      // El texto es la prueba de a QUE dijo que si: un permiso sin descripcion
      // es un consentimiento que no se puede demostrar.
      expect(permiso.descripcion.length).toBeGreaterThan(20);
      expect(permiso.efecto.length).toBeGreaterThan(0);
    }
  });

  it('B12 pide tres permisos y el Mentor IA no es uno de ellos', () => {
    const enElRegistro = CATALOGO.filter((p) => p.sePideEnElRegistro).map((p) => p.tipo);

    expect(enElRegistro).toEqual([
      TipoDeConsentimiento.Biometria,
      TipoDeConsentimiento.CalificacionIA,
      TipoDeConsentimiento.PerfilPublico,
    ]);
    // Aparece en el panel de B24 y nadie lo pide: esa es la contradiccion §6.9.
    expect(enElRegistro).not.toContain(TipoDeConsentimiento.MentorIA);
  });

  it('solo nacen encendidos los que B12 muestra encendidos', () => {
    const encendidos = CATALOGO.filter((p) => p.porOmision).map((p) => p.tipo);

    expect(encendidos).toEqual([
      TipoDeConsentimiento.Biometria,
      TipoDeConsentimiento.CalificacionIA,
    ]);
  });

  it('lo que nunca se pidio nace apagado', () => {
    // Tratar datos para una finalidad que el titular no autorizo es lo que la
    // Ley 1581 prohibe. Si no se pregunta, no se asume que si.
    for (const permiso of CATALOGO.filter((p) => !p.sePideEnElRegistro)) {
      expect(permiso.porOmision).toBe(false);
    }
  });

  it('solo la calificacion por IA se hace cumplir, y el resto lo declara', () => {
    // Decidido el 28/10 (D-17): entregas lo exige antes de aceptar nada. Los
    // otros tres siguen sin vigilar porque las funciones que gobiernan
    // —proctoring, banco de talento, Mentor IA— no existen. Declararlo es la
    // diferencia entre un registro honesto y una pantalla que miente.
    const vigilados = CATALOGO.filter((p) => p.vigilado).map((p) => p.tipo);

    expect(vigilados).toEqual([TipoDeConsentimiento.CalificacionIA]);
  });

  it('el permiso que se hace cumplir dice lo que cuesta revocarlo', () => {
    const permiso = permisoDelCatalogo(TipoDeConsentimiento.CalificacionIA);

    // Quien lo apaga tiene que saber antes que deja de poder entregar, y que
    // lo ya entregado no se deshace.
    expect(permiso.efecto).toMatch(/dejas de poder entregar/i);
    expect(permiso.efecto).toMatch(/no se deshacen/i);
  });

  it('la version del aviso tiene forma de fecha', () => {
    expect(VERSION_DEL_AVISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pedir un permiso que no esta en el catalogo falla en vez de devolver nada', () => {
    expect(() => permisoDelCatalogo('inventado' as TipoDeConsentimiento)).toThrow(/catalogo/i);
  });
});
