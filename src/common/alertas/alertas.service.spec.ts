import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertasService, REGLAS } from './alertas.service.js';
import type { CorreoService } from './correo.js';
import { BusDeEventos } from '../events/index.js';
import type { EventoDeSeguridad, TipoDeEventoDeSeguridad } from './evento-de-seguridad.js';

function correoFalso(enviaBien = true) {
  const enviados: { asunto: string; cuerpo: string }[] = [];
  const correo = {
    configurado: enviaBien,
    enviar: (asunto: string, cuerpo: string) => {
      enviados.push({ asunto, cuerpo });
      return Promise.resolve(enviaBien);
    },
  } as unknown as CorreoService;
  return { correo, enviados };
}

const evento = (
  tipo: TipoDeEventoDeSeguridad,
  clave = 'ip:10.0.0.1',
  extra: Partial<EventoDeSeguridad> = {},
): EventoDeSeguridad => ({
  tipo,
  clave,
  momento: new Date().toISOString(),
  ...extra,
});

describe('alertas de seguridad', () => {
  /** Lo que se registro, sin tocar el objeto del espia (y sin `any`). */
  let registros: string[];

  beforeEach(() => {
    registros = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((mensaje: unknown) => {
      registros.push(String(mensaje));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('CRITERIO: cada evento de seguridad queda registrado', () => {
    it('registra con marca de tiempo, tipo, usuario, IP y ruta, aunque no avise', async () => {
      const { correo, enviados } = correoFalso();
      const alertas = new AlertasService(new BusDeEventos(), correo);

      await alertas.procesar(
        evento('auth_failure', 'usuario:u-1', {
          userId: 'u-1',
          ip: '10.0.0.1',
          ruta: '/api/v1/autenticacion/login',
          metodo: 'POST',
        }),
      );

      // Un solo fallo no llega al umbral: no hay correo, pero si registro.
      expect(enviados).toHaveLength(0);
      const registro = JSON.parse(registros[0]) as Record<string, unknown>;
      expect(registro).toMatchObject({
        level: 'security',
        eventType: 'auth_failure',
        userId: 'u-1',
        ip: '10.0.0.1',
        path: '/api/v1/autenticacion/login',
        method: 'POST',
      });
      expect(String(registro.timestamp)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('umbral: se avisa del patron, no de cada evento', () => {
    it('cinco fallos de la misma clave en la ventana disparan un correo', async () => {
      const { correo, enviados } = correoFalso();
      const alertas = new AlertasService(new BusDeEventos(), correo);
      const ahora = Date.now();

      for (let i = 0; i < REGLAS.auth_failure.umbral; i++) {
        await alertas.procesar(evento('auth_failure'), ahora + i * 1000);
      }

      expect(enviados).toHaveLength(1);
      expect(enviados[0].asunto).toMatch(/fallos de autenticacion/i);
      expect(enviados[0].cuerpo).toContain('ip:10.0.0.1');
    });

    it('los fallos de claves distintas no se suman entre si', async () => {
      // Sin esto, una oficina entera detras de la misma IP disparia la alerta de
      // una sola persona, y al reves: cinco personas distintas no son un ataque
      // a una cuenta.
      const { correo, enviados } = correoFalso();
      const alertas = new AlertasService(new BusDeEventos(), correo);

      for (let i = 0; i < 4; i++) {
        await alertas.procesar(evento('auth_failure', `usuario:u-${i}`));
      }

      expect(enviados).toHaveLength(0);
    });

    it('los eventos viejos salen de la ventana y no cuentan', async () => {
      const { correo, enviados } = correoFalso();
      const alertas = new AlertasService(new BusDeEventos(), correo);
      const base = Date.now();
      const regla = REGLAS.auth_failure;

      for (let i = 0; i < regla.umbral - 1; i++) {
        await alertas.procesar(evento('auth_failure'), base);
      }
      // El ultimo llega cuando los anteriores ya caducaron.
      await alertas.procesar(evento('auth_failure'), base + regla.ventanaMs + 1000);

      expect(enviados).toHaveLength(0);
    });

    it('un intento de inyeccion avisa de inmediato: no hay patron que esperar', async () => {
      const { correo, enviados } = correoFalso();
      const alertas = new AlertasService(new BusDeEventos(), correo);

      await alertas.procesar(
        evento('inyeccion_detectada', 'entrega:e-1', {
          metadata: { riesgo: 'alto', idEntrega: 'e-1' },
        }),
      );

      expect(enviados).toHaveLength(1);
      expect(enviados[0].asunto).toMatch(/inyeccion/i);
      expect(enviados[0].cuerpo).toContain('riesgo');
    });
  });

  describe('silencio: un ataque no genera mil correos', () => {
    it('tras avisar, la misma regla y clave callan un rato', async () => {
      const { correo, enviados } = correoFalso();
      const alertas = new AlertasService(new BusDeEventos(), correo);
      const base = Date.now();
      const regla = REGLAS.auth_failure;

      for (let i = 0; i < regla.umbral; i++) await alertas.procesar(evento('auth_failure'), base);
      // Otros cien eventos durante el silencio.
      for (let i = 0; i < 100; i++) await alertas.procesar(evento('auth_failure'), base + 1000);

      expect(enviados).toHaveLength(1);
    });

    it('pasado el silencio vuelve a avisar, y dice cuantos se omitieron', async () => {
      const { correo, enviados } = correoFalso();
      const alertas = new AlertasService(new BusDeEventos(), correo);
      const base = Date.now();
      const regla = REGLAS.auth_failure;

      for (let i = 0; i < regla.umbral; i++) await alertas.procesar(evento('auth_failure'), base);
      for (let i = 0; i < 7; i++) await alertas.procesar(evento('auth_failure'), base + 1000);

      const despues = base + regla.silencioMs + 1000;
      for (let i = 0; i < regla.umbral; i++) {
        await alertas.procesar(evento('auth_failure'), despues);
      }

      expect(enviados).toHaveLength(2);
      expect(enviados[1].cuerpo).toMatch(/se omitieron 7 avisos/);
    });

    it('cada tipo de evento tiene su propio silencio', async () => {
      const { correo, enviados } = correoFalso();
      const alertas = new AlertasService(new BusDeEventos(), correo);
      const base = Date.now();

      for (let i = 0; i < REGLAS.auth_failure.umbral; i++) {
        await alertas.procesar(evento('auth_failure'), base);
      }
      await alertas.procesar(evento('inyeccion_detectada', 'entrega:e-1'), base);

      expect(enviados).toHaveLength(2);
    });
  });

  describe('el fallo del canal no tumba nada', () => {
    it('si el correo no esta configurado, la alerta queda registrada igual', async () => {
      const { correo } = correoFalso(false);
      const alertas = new AlertasService(new BusDeEventos(), correo);

      await alertas.procesar(evento('inyeccion_detectada', 'entrega:e-1'));

      const disparada = registros.find((r) => r.includes('alerta_disparada'));
      expect(disparada).toBeDefined();
      expect(disparada).toContain('"enviadaPorCorreo":false');
    });
  });

  describe('suscripcion al bus', () => {
    it('procesa lo que llega por el bus y se desuscribe al cerrar', async () => {
      const { correo, enviados } = correoFalso();
      const bus = new BusDeEventos();
      const alertas = new AlertasService(bus, correo);
      alertas.onModuleInit();

      bus.publicar<EventoDeSeguridad>({
        name: 'seguridad.evento',
        occurredAt: new Date(),
        payload: evento('inyeccion_detectada', 'entrega:e-1'),
      });
      await vi.waitFor(() => expect(enviados).toHaveLength(1));

      alertas.onModuleDestroy();
      bus.publicar<EventoDeSeguridad>({
        name: 'seguridad.evento',
        occurredAt: new Date(),
        payload: evento('inyeccion_detectada', 'entrega:e-2'),
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(enviados).toHaveLength(1);
    });
  });
});
