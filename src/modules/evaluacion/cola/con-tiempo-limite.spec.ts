import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conTiempoLimite } from './con-tiempo-limite.js';
import { ServicioDeIaNoDisponibleError } from './evaluador.js';

describe('tiempo limite de un intento de evaluacion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve el resultado si llega a tiempo', async () => {
    await expect(conTiempoLimite(() => Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it('propaga el error propio del trabajo', async () => {
    const error = new Error('fallo del proveedor');
    await expect(conTiempoLimite(() => Promise.reject(error), 1000)).rejects.toBe(error);
  });

  it('al vencer, rechaza con un error transitorio y aborta la senal', async () => {
    let senalRecibida: AbortSignal | undefined;
    const promesa = conTiempoLimite((senal) => {
      senalRecibida = senal;
      return new Promise<never>(() => undefined);
    }, 1000);

    const verificacion = expect(promesa).rejects.toBeInstanceOf(ServicioDeIaNoDisponibleError);
    await vi.advanceTimersByTimeAsync(1000);
    await verificacion;
    expect(senalRecibida?.aborted).toBe(true);
  });

  it('un trabajo que rechaza despues de vencido no deja un rechazo sin manejar', async () => {
    const sinManejar = vi.fn();
    process.on('unhandledRejection', sinManejar);

    let rechazarTarde!: (e: Error) => void;
    const promesa = conTiempoLimite(
      () => new Promise<never>((_, rechazar) => (rechazarTarde = rechazar)),
      1000,
    );
    const verificacion = expect(promesa).rejects.toBeInstanceOf(ServicioDeIaNoDisponibleError);
    await vi.advanceTimersByTimeAsync(1000);
    await verificacion;

    rechazarTarde(new Error('llego tarde'));
    await vi.runAllTimersAsync();
    await Promise.resolve();

    process.off('unhandledRejection', sinManejar);
    expect(sinManejar).not.toHaveBeenCalled();
  });

  it('no deja temporizadores vivos cuando el trabajo termina antes', async () => {
    await conTiempoLimite(() => Promise.resolve('ok'), 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
