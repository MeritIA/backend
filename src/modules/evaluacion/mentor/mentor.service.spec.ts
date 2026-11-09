import { HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { ConsentimientosService } from '../../autenticacion/index.js';
import type { EjerciciosService } from '../../ejercicios/index.js';
import type { Solicitante } from '../../vacantes/index.js';
import type { ClienteServicioIa } from '../cola/cliente-servicio-ia.js';
import type { EvaluacionService } from '../evaluacion.service.js';
import { MentorService } from './mentor.service.js';

const solicitante = { id: 'u1' } as Solicitante;

function armar(maximo: number, respuesta: Promise<{ respuesta: string; sugerencias: string[] }>) {
  const preguntarAlMentor = vi.fn().mockReturnValue(respuesta);
  const servicio = new MentorService(
    {
      mias: () =>
        Promise.resolve([
          { id: 'e1', idVersion: 'v1', notaFinal: 70, descalificada: false, criterios: [] },
        ]),
    } as unknown as EvaluacionService,
    { versionPorId: () => Promise.resolve(null) } as unknown as EjerciciosService,
    { autoriza: () => Promise.resolve(true) } as unknown as ConsentimientosService,
    { preguntarAlMentor } as unknown as ClienteServicioIa,
    { get: () => maximo } as unknown as ConfigService,
  );
  return { servicio, preguntarAlMentor };
}

describe('MentorService: tope de preguntas simultaneas', () => {
  it('rechaza con 429 la pregunta que pasa el tope, sin llamar a la IA', async () => {
    let liberar!: (v: { respuesta: string; sugerencias: string[] }) => void;
    const lenta = new Promise<{ respuesta: string; sugerencias: string[] }>((r) => (liberar = r));
    const { servicio, preguntarAlMentor } = armar(2, lenta);

    const a = servicio.preguntar('uno', [], solicitante);
    const b = servicio.preguntar('dos', [], solicitante);
    await vi.waitFor(() => expect(preguntarAlMentor).toHaveBeenCalledTimes(2));

    const rechazo = await servicio.preguntar('tres', [], solicitante).catch((e: unknown) => e);
    expect(rechazo).toBeInstanceOf(HttpException);
    expect((rechazo as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(preguntarAlMentor).toHaveBeenCalledTimes(2);

    liberar({ respuesta: 'ok', sugerencias: [] });
    await Promise.all([a, b]);
  });

  it('libera el cupo aunque la IA falle', async () => {
    const { servicio, preguntarAlMentor } = armar(1, Promise.reject(new Error('cae')));
    await expect(servicio.preguntar('uno', [], solicitante)).rejects.toThrow('cae');
    preguntarAlMentor.mockResolvedValueOnce({ respuesta: 'ya', sugerencias: [] });
    await expect(servicio.preguntar('dos', [], solicitante)).resolves.toMatchObject({
      respuesta: 'ya',
    });
  });
});
