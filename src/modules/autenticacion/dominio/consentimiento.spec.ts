import { describe, expect, it } from 'vitest';
import {
  CATALOGO,
  permisoDelCatalogo,
  seOfrece,
  TipoDeConsentimiento,
  VERSION_DEL_AVISO,
} from './consentimiento.js';

/**
 * El catalogo es una transcripcion de dos pantallas, no una invencion. Estas
 * pruebas fijan lo que esas pantallas dicen, para que cambiarlo tenga que ser
 * una decision y no un descuido.
 */
describe('catalogo de consentimientos', () => {
  it('son las TRES finalidades del Taller 2, en su orden', () => {
    // "Separar el consentimiento unico en pasos diferenciados por finalidad
    //  (grabacion/biometria, calificacion por IA, publicacion del perfil a
    //  terceros en el banco de talento)". Son las tres tarjetas de B12.
    expect(CATALOGO.map((p) => p.tipo)).toEqual([
      TipoDeConsentimiento.Biometria,
      TipoDeConsentimiento.CalificacionIA,
      TipoDeConsentimiento.PerfilPublico,
    ]);
  });

  it('el Mentor IA se puede leer del historial pero ya no se ofrece', () => {
    // Aparece en el panel de B24 y en ningun documento mas. Sigue en el enum
    // para que las filas viejas se puedan leer; un registro de
    // consentimientos que no puede leer su pasado no sirve para lo que existe.
    expect(seOfrece(TipoDeConsentimiento.MentorIA)).toBe(false);
    expect(seOfrece(TipoDeConsentimiento.PerfilPublico)).toBe(true);
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

  it('las tres se piden en el registro: ninguna se trata sin preguntar', () => {
    // El defecto que el Taller 2 encontro era justo el contrario: un
    // consentimiento inicial que se daba por bueno para todo el ciclo del dato.
    for (const permiso of CATALOGO) {
      expect(permiso.sePideEnElRegistro).toBe(true);
    }
  });

  it('solo nacen encendidos los que B12 muestra encendidos', () => {
    const encendidos = CATALOGO.filter((p) => p.porOmision).map((p) => p.tipo);

    expect(encendidos).toEqual([
      TipoDeConsentimiento.Biometria,
      TipoDeConsentimiento.CalificacionIA,
    ]);
  });

  it('la publicacion del perfil nace apagada, pase lo que pase en el BPM', () => {
    // El paso 13 del BPM publica el perfil de todo el mundo en el banco de
    // talento. Es el defecto que el Taller 2 marco y que el rediseno no
    // aplico. Manda el Taller 2 (D-18): sin permiso no se publica.
    expect(permisoDelCatalogo(TipoDeConsentimiento.PerfilPublico).porOmision).toBe(false);
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
