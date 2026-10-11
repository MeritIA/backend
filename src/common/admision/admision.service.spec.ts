import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdmisionService } from './admision.service.js';

/** El tope se pasa por el entorno, igual que en ejecucion. */
const conTope = (maximo: number) =>
  new AdmisionService({ ADMISION_MAXIMO_EN_VUELO: String(maximo) });

describe('control de admision', () => {
  /** Lo que se registro, sin tocar el objeto del espia (y sin `any`). */
  let registros: string[];

  beforeEach(() => {
    registros = [];
    const capturar = (mensaje: unknown): void => {
      registros.push(String(mensaje));
    };
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(capturar);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(capturar);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('el tope', () => {
    it('deja entrar hasta el maximo y rechaza la siguiente', () => {
      const admision = conTope(3);

      expect([1, 2, 3].map(() => admision.intentarEntrar())).toEqual([true, true, true]);
      expect(admision.intentarEntrar()).toBe(false);
      expect(admision.metricas()).toMatchObject({ enVuelo: 3, maximo: 3, saturado: true });
    });

    it('una peticion rechazada NO ocupa cupo', () => {
      // Si el rechazo contara, el contador subiria sin freno bajo saturacion y
      // el sistema no volveria a admitir nada nunca.
      const admision = conTope(1);
      admision.intentarEntrar();
      admision.intentarEntrar();
      admision.intentarEntrar();

      expect(admision.metricas().enVuelo).toBe(1);
      expect(admision.metricas().rechazadas).toBe(2);
    });

    it('al liberar un cupo vuelve a admitir', () => {
      const admision = conTope(1);
      expect(admision.intentarEntrar()).toBe(true);
      expect(admision.intentarEntrar()).toBe(false);

      admision.salir();

      expect(admision.intentarEntrar()).toBe(true);
    });

    it('liberar de mas no deja el contador en negativo', () => {
      // Pasaria si el middleware escuchara dos eventos de la misma respuesta.
      // Se protege en los dos lados, porque un contador negativo daria cupos
      // de regalo y el tope dejaria de significar nada.
      const admision = conTope(2);
      admision.salir();
      admision.salir();

      expect(admision.metricas().enVuelo).toBe(0);
    });

    it('con tope 0 rechaza todo, que es lo que hace deterministica la prueba de integracion', () => {
      const admision = conTope(0);
      expect(admision.intentarEntrar()).toBe(false);
    });

    it('sin configurar usa 50, el valor derivado de la medicion', () => {
      expect(new AdmisionService({}).maximoEnVuelo).toBe(50);
    });

    it('un valor invalido cae al valor por omision en vez de dejar el tope en NaN', () => {
      // Con NaN, la comparacion `enVuelo >= NaN` es siempre falsa y el control
      // de admision quedaria desactivado EN SILENCIO. Es el peor de los fallos:
      // el sistema parece protegido y no lo esta.
      expect(conTope(Number.NaN).maximoEnVuelo).toBe(50);
      expect(new AdmisionService({ ADMISION_MAXIMO_EN_VUELO: 'muchas' }).maximoEnVuelo).toBe(50);
    });
  });

  describe('el registro: un log por episodio, no por rechazo', () => {
    it('registra el comienzo de la saturacion una sola vez', () => {
      const admision = conTope(1);
      admision.intentarEntrar();
      for (let i = 0; i < 50; i++) admision.intentarEntrar();

      // Cincuenta rechazos, un solo aviso: un log por peticion inundaria el
      // disco justo cuando el sistema esta ahogado.
      expect(registros.filter((r) => r.includes('admision_saturada'))).toHaveLength(1);
    });

    it('al recuperarse dice cuantas rechazo en el episodio', () => {
      const admision = conTope(5);
      for (let i = 0; i < 5; i++) admision.intentarEntrar();
      for (let i = 0; i < 7; i++) admision.intentarEntrar();

      // Baja del 80 % del tope: con 5, hay que soltar hasta 3 en vuelo.
      admision.salir();
      admision.salir();

      const recuperada = registros.find((r) => r.includes('admision_recuperada'));
      expect(recuperada).toBeDefined();
      expect(recuperada).toContain('"rechazadasEnElEpisodio":7');
    });

    it('no oscila: soltar una sola peticion en el tope no cuenta como recuperado', () => {
      // Sin la holgura, en el limite exacto una entrada y una salida harian
      // entrar y salir del estado en cada ciclo, y el log se llenaria de
      // transiciones que no informan de nada.
      const admision = conTope(5);
      for (let i = 0; i < 5; i++) admision.intentarEntrar();
      admision.intentarEntrar();

      admision.salir();

      expect(admision.metricas().saturado).toBe(true);
      expect(registros.filter((r) => r.includes('admision_recuperada'))).toHaveLength(0);
    });
  });
});
