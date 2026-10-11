import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SaludService,
  TIEMPO_MAXIMO_POR_DEPENDENCIA_MS,
  type ResultadoDeComprobacion,
} from './salud.service.js';

const ok = (): Promise<ResultadoDeComprobacion> => Promise.resolve({ estado: 'ok' });
const caido = (): Promise<ResultadoDeComprobacion> =>
  Promise.resolve({ estado: 'caido', detalle: 'sin conexion' });

describe('estado de las dependencias', () => {
  let salud: SaludService;
  let errorRegistrado: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    salud = new SaludService();
    errorRegistrado = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('sin nada registrado, esta listo: no hay nada que pueda estar caido', async () => {
    const r = await salud.comprobarTodo();
    expect(r.estado).toBe('listo');
    expect(r.dependencias).toHaveLength(0);
  });

  it('con todo en pie, listo y con el detalle de cada una', async () => {
    salud.registrar('base_de_datos', true, ok);
    salud.registrar('servicio_ia', false, ok);

    const r = await salud.comprobarTodo();

    expect(r.estado).toBe('listo');
    expect(r.dependencias.map((d) => d.nombre).sort()).toEqual(['base_de_datos', 'servicio_ia']);
    expect(r.dependencias[0].duracionMs).toBeGreaterThanOrEqual(0);
  });

  describe('CRITERIO: refleja la caida de cualquiera de las dependencias', () => {
    it('una dependencia CRITICA caida deja el backend no listo', async () => {
      salud.registrar('base_de_datos', true, caido);
      salud.registrar('servicio_ia', false, ok);

      const r = await salud.comprobarTodo();

      expect(r.estado).toBe('no_listo');
      expect(r.dependencias.find((d) => d.nombre === 'base_de_datos')).toMatchObject({
        estado: 'caido',
        critica: true,
      });
    });

    it('una NO critica caida lo deja degradado, no fuera de servicio', async () => {
      // Sin servicio de IA se siguen recibiendo entregas; se evaluaran despues.
      salud.registrar('base_de_datos', true, ok);
      salud.registrar('servicio_ia', false, caido);

      expect((await salud.comprobarTodo()).estado).toBe('degradado');
    });

    it('una dependencia sin configurar no tumba el estado general', async () => {
      salud.registrar('servicio_ia', false, () =>
        Promise.resolve({ estado: 'sin_configurar', detalle: 'falta AI_SERVICE_URL' }),
      );
      expect((await salud.comprobarTodo()).estado).toBe('listo');
    });
  });

  describe('una dependencia colgada no cuelga la pagina de estado', () => {
    it('se corta al tiempo maximo y se marca caida', async () => {
      vi.useFakeTimers();
      salud.registrar('cola', true, () => new Promise<ResultadoDeComprobacion>(() => undefined));

      const promesa = salud.comprobarTodo();
      await vi.advanceTimersByTimeAsync(TIEMPO_MAXIMO_POR_DEPENDENCIA_MS + 10);
      const r = await promesa;

      expect(r.dependencias[0]).toMatchObject({
        estado: 'caido',
        detalle: 'no respondio a tiempo',
      });
      expect(r.estado).toBe('no_listo');
      vi.useRealTimers();
    });

    it('se comprueban en paralelo, no en serie', async () => {
      vi.useFakeTimers();
      const lenta = () =>
        new Promise<ResultadoDeComprobacion>((resolver) =>
          setTimeout(() => resolver({ estado: 'ok' }), 1000),
        );
      salud.registrar('a', true, lenta);
      salud.registrar('b', true, lenta);
      salud.registrar('c', true, lenta);

      const promesa = salud.comprobarTodo();
      // En serie harian falta 3000 ms; en paralelo bastan 1000.
      await vi.advanceTimersByTimeAsync(1100);
      const r = await promesa;

      expect(r.estado).toBe('listo');
      vi.useRealTimers();
    });
  });

  describe('errores y mensajes', () => {
    it('una comprobacion que lanza se marca caida sin filtrar el mensaje', async () => {
      salud.registrar('base_de_datos', true, () =>
        Promise.reject(new Error('password authentication failed for user "meritia"')),
      );

      const r = await salud.comprobarTodo();

      expect(r.dependencias[0].estado).toBe('caido');
      // El mensaje puede traer la cadena de conexion: al cliente solo el tipo.
      expect(JSON.stringify(r)).not.toContain('password');
      expect(r.dependencias[0].detalle).toBe('Error');
      // Pero al log si va, que es donde se diagnostica.
      expect(errorRegistrado).toHaveBeenCalledTimes(1);
    });

    it('registrar dos veces el mismo nombre no lo duplica', async () => {
      salud.registrar('cola', true, caido);
      salud.registrar('cola', true, ok);

      const r = await salud.comprobarTodo();

      expect(r.dependencias).toHaveLength(1);
      expect(r.dependencias[0].estado).toBe('ok');
      expect(salud.nombresRegistrados).toEqual(['cola']);
    });
  });
});
