import { describe, expect, it } from 'vitest';
import { leerPoliticaDeCola, opcionesDeTrabajo } from './politica-de-cola.js';

describe('politica de la cola de evaluacion', () => {
  it('sin configuracion usa valores prudentes', () => {
    const p = leerPoliticaDeCola({});
    expect(p).toMatchObject({
      prefijo: 'meritia',
      workerHabilitado: true,
      concurrencia: 2,
      reintentos: 5,
      backoffMs: 15_000,
      timeoutMs: 120_000,
    });
  });

  it('lee la configuracion del entorno', () => {
    const p = leerPoliticaDeCola({
      COLA_WORKER_HABILITADO: 'false',
      COLA_CONCURRENCIA: '8',
      COLA_REINTENTOS: '3',
      COLA_BACKOFF_MS: '500',
      COLA_TIMEOUT_MS: '5000',
    });
    expect(p).toMatchObject({
      workerHabilitado: false,
      concurrencia: 8,
      reintentos: 3,
      backoffMs: 500,
      timeoutMs: 5000,
    });
  });

  it.each([
    ['COLA_REINTENTOS', '0', 'reintentos', 5],
    ['COLA_REINTENTOS', 'muchos', 'reintentos', 5],
    ['COLA_CONCURRENCIA', '1000', 'concurrencia', 2],
    ['COLA_TIMEOUT_MS', '10', 'timeoutMs', 120_000],
    ['COLA_BACKOFF_MS', '1.5', 'backoffMs', 15_000],
  ] as const)(
    'un valor invalido en %s=%s vuelve al valor por omision',
    (clave, valor, campo, esperado) => {
      expect(leerPoliticaDeCola({ [clave]: valor })[campo]).toBe(esperado);
    },
  );

  it('cualquier valor distinto de "false" deja el worker encendido', () => {
    // Apagarlo por error dejaria la cola creciendo sin nadie que la consuma.
    expect(leerPoliticaDeCola({ COLA_WORKER_HABILITADO: 'no' }).workerHabilitado).toBe(true);
  });

  it('las opciones de trabajo reintentan con backoff exponencial y conservan los fallidos', () => {
    const o = opcionesDeTrabajo(
      leerPoliticaDeCola({ COLA_REINTENTOS: '4', COLA_BACKOFF_MS: '100' }),
    );
    expect(o.attempts).toBe(4);
    expect(o.backoff).toMatchObject({ type: 'exponential', delay: 100 });
    // Los fallidos se conservan un mes: son la cola de trabajos muertos.
    expect(o.removeOnFail).toEqual({ age: 30 * 24 * 3600 });
    expect(o.removeOnComplete).toEqual({ age: 24 * 3600 });
  });
});
