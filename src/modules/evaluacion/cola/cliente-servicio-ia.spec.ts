import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClienteServicioIa, type PeticionDeEvaluacion } from './cliente-servicio-ia.js';
import { EvaluacionNoReintentableError, ServicioDeIaNoDisponibleError } from './evaluador.js';

const CLAVE = 'clave-compartida-de-prueba';

function config(valores: Record<string, string> = {}): ConfigService {
  const base: Record<string, string> = {
    AI_SERVICE_URL: 'http://servicio-ia:3000',
    AI_SERVICE_API_KEY: CLAVE,
    ...valores,
  };
  return { get: (clave: string) => base[clave] } as unknown as ConfigService;
}

const PETICION: PeticionDeEvaluacion = {
  idEvaluacion: '7f1c2b8e-3d4a-4c5b-9e6f-1a2b3c4d5e6f',
  enunciado: 'Implementa una funcion que invierta una lista.',
  criterios: [
    { nombre: 'Correccion', descripcion: 'Invierte cualquier lista.', peso: 60, escalaMaxima: 5 },
    { nombre: 'Claridad', descripcion: 'Codigo legible.', peso: 40, escalaMaxima: 10 },
  ],
  archivos: [{ ruta: 'main.py', contenido: 'def invertir(l): return l[::-1]' }],
};

const respuestaValida = {
  idEvaluacion: PETICION.idEvaluacion,
  notaFinal: 68,
  criterios: [
    {
      criterio: 'Correccion',
      puntaje: 4,
      escalaMaxima: 5,
      peso: 60,
      evidencia: 'Cubre el caso vacio.',
    },
    { criterio: 'Claridad', puntaje: 5, escalaMaxima: 10, peso: 40, evidencia: 'Nombres claros.' },
  ],
  proveedor: 'gemini',
  modelo: 'gemini-2.5-flash',
};

function fingirRespuesta(cuerpo: unknown, estado = 200) {
  const fetchFalso = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(cuerpo), {
        status: estado,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

const evaluar = (c: ClienteServicioIa) => c.evaluar(PETICION, new AbortController().signal);

describe('cliente del servicio de IA', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envia la peticion con la clave compartida y devuelve el resultado validado', async () => {
    const fetchFalso = fingirRespuesta(respuestaValida);

    const r = await evaluar(new ClienteServicioIa(config()));

    expect(r.notaFinal).toBe(68);
    expect(r.criterios.map((c) => c.criterio)).toEqual(['Correccion', 'Claridad']);

    const [url, opciones] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://servicio-ia:3000/api/v1/evaluaciones');
    expect((opciones.headers as Record<string, string>).Authorization).toBe(`Bearer ${CLAVE}`);
  });

  it('sin configurar, falla con un motivo claro y sin llamar a nadie', async () => {
    const fetchFalso = fingirRespuesta(respuestaValida);
    const cliente = new ClienteServicioIa(config({ AI_SERVICE_URL: '', AI_SERVICE_API_KEY: '' }));

    expect(cliente.configurado).toBe(false);
    await expect(evaluar(cliente)).rejects.toBeInstanceOf(ServicioDeIaNoDisponibleError);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('un fallo de red es transitorio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    await expect(evaluar(new ClienteServicioIa(config()))).rejects.toBeInstanceOf(
      ServicioDeIaNoDisponibleError,
    );
  });

  it('respeta el campo reintentable del servicio', async () => {
    fingirRespuesta({ codigo: 'PROVEEDOR_NO_DISPONIBLE', reintentable: true }, 503);
    await expect(evaluar(new ClienteServicioIa(config()))).rejects.toBeInstanceOf(
      ServicioDeIaNoDisponibleError,
    );

    fingirRespuesta({ codigo: 'SOLICITUD_RECHAZADA_POR_PROVEEDOR', reintentable: false }, 422);
    await expect(evaluar(new ClienteServicioIa(config()))).rejects.toBeInstanceOf(
      EvaluacionNoReintentableError,
    );
  });

  it('sin ese campo, los 5xx se reintentan y los 4xx no', async () => {
    fingirRespuesta({ codigo: 'INTERNO' }, 500);
    await expect(evaluar(new ClienteServicioIa(config()))).rejects.toBeInstanceOf(
      ServicioDeIaNoDisponibleError,
    );

    fingirRespuesta({ codigo: 'VALIDACION' }, 400);
    await expect(evaluar(new ClienteServicioIa(config()))).rejects.toBeInstanceOf(
      EvaluacionNoReintentableError,
    );
  });

  describe('no se confia en la respuesta: el backend la valida', () => {
    it.each([
      [
        'otro identificador',
        { ...respuestaValida, idEvaluacion: 'ffffffff-0000-4000-8000-000000000000' },
      ],
      ['nota fuera de rango', { ...respuestaValida, notaFinal: 140 }],
      ['nota que no es numero', { ...respuestaValida, notaFinal: '68' }],
      ['faltan criterios', { ...respuestaValida, criterios: [respuestaValida.criterios[0]] }],
      [
        'un criterio que no esta en la rubrica',
        {
          ...respuestaValida,
          criterios: [
            respuestaValida.criterios[0],
            { ...respuestaValida.criterios[1], criterio: 'Actitud' },
          ],
        },
      ],
      [
        'puntaje fuera de la escala',
        {
          ...respuestaValida,
          criterios: [
            { ...respuestaValida.criterios[0], puntaje: 9 },
            respuestaValida.criterios[1],
          ],
        },
      ],
      [
        'evidencia vacia',
        {
          ...respuestaValida,
          criterios: [
            { ...respuestaValida.criterios[0], evidencia: '  ' },
            respuestaValida.criterios[1],
          ],
        },
      ],
    ])('rechaza %s', async (_caso, cuerpo) => {
      fingirRespuesta(cuerpo);
      await expect(evaluar(new ClienteServicioIa(config()))).rejects.toBeInstanceOf(
        EvaluacionNoReintentableError,
      );
    });

    it('el peso y la escala salen de NUESTRA rubrica, no de la respuesta', async () => {
      fingirRespuesta({
        ...respuestaValida,
        criterios: [
          {
            criterio: 'Correccion',
            puntaje: 4,
            escalaMaxima: 999,
            peso: 999,
            evidencia: 'ok, lo cubre',
          },
          {
            criterio: 'Claridad',
            puntaje: 5,
            escalaMaxima: 1,
            peso: 1,
            evidencia: 'nombres claros',
          },
        ],
      });

      const r = await evaluar(new ClienteServicioIa(config()));

      expect(r.criterios[0]).toMatchObject({ escalaMaxima: 5, peso: 60 });
      expect(r.criterios[1]).toMatchObject({ escalaMaxima: 10, peso: 40 });
    });
  });
});
