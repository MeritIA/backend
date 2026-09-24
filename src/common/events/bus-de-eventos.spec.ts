import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusDeEventos } from './bus-de-eventos.js';
import type { DomainEvent } from './domain-event.js';

const evento = (name: string, payload: unknown = {}): DomainEvent<unknown> => ({
  name,
  occurredAt: new Date(),
  payload,
});

describe('bus de eventos en memoria', () => {
  let bus: BusDeEventos;
  let errorRegistrado: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bus = new BusDeEventos();
    errorRegistrado = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('entrega el evento a quien se suscribio a ese nombre, y solo a ese', async () => {
    const a = vi.fn();
    const b = vi.fn();
    bus.suscribir('uno', a);
    bus.suscribir('dos', b);

    bus.publicar(evento('uno', { x: 1 }));

    await vi.waitFor(() => expect(a).toHaveBeenCalledTimes(1));
    expect(a.mock.calls[0][0]).toMatchObject({ name: 'uno', payload: { x: 1 } });
    expect(b).not.toHaveBeenCalled();
  });

  it('no entrega de forma sincrona: publicar no ejecuta al suscriptor en el mismo tick', () => {
    // Si fuera sincrono, un suscriptor lento o que falla haria lenta o fallida
    // la peticion del candidato que publico el evento.
    const manejador = vi.fn();
    bus.suscribir('uno', manejador);
    bus.publicar(evento('uno'));
    expect(manejador).not.toHaveBeenCalled();
  });

  it('un suscriptor que falla no impide que los demas reciban el evento', async () => {
    const roto = vi.fn(() => {
      throw new Error('fallo del suscriptor');
    });
    const rotoAsincrono = vi.fn(() => Promise.reject(new Error('fallo asincrono')));
    const sano = vi.fn();
    bus.suscribir('uno', roto);
    bus.suscribir('uno', rotoAsincrono);
    bus.suscribir('uno', sano);

    expect(() => bus.publicar(evento('uno'))).not.toThrow();

    await vi.waitFor(() => expect(sano).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(errorRegistrado).toHaveBeenCalledTimes(2));
  });

  it('desuscribirse deja de recibir', async () => {
    const manejador = vi.fn();
    const testigo = vi.fn();
    const cancelar = bus.suscribir('uno', manejador);
    bus.suscribir('uno', testigo);

    cancelar();
    bus.publicar(evento('uno'));

    await vi.waitFor(() => expect(testigo).toHaveBeenCalledTimes(1));
    expect(manejador).not.toHaveBeenCalled();
  });

  it('publicar sin suscriptores no hace nada', () => {
    expect(() => bus.publicar(evento('nadie-escucha'))).not.toThrow();
  });
});
