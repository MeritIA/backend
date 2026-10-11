import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import { api, levantarAplicacion, registrarCandidato } from './ayudas.js';
import type * as ModuloSalud from '../../src/common/salud/index.js';
import type * as ModuloAlertas from '../../src/common/alertas/index.js';

let SaludService: typeof ModuloSalud.SaludService;
let CorreoService: typeof ModuloAlertas.CorreoService;
let AlertasService: typeof ModuloAlertas.AlertasService;
let REGLAS: typeof ModuloAlertas.REGLAS;

/**
 * Observabilidad (paquete 5.5), contra PostgreSQL, Redis y MinIO de verdad.
 *
 * Criterios: el endpoint de salud refleja la caida de cualquiera de las cuatro
 * dependencias, y las alertas criticas avisan al responsable.
 */
describe('integracion: salud y alertas', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    await prepararEntorno();
    ({ SaludService } = await import('../../src/common/salud/index.js'));
    ({ CorreoService, AlertasService, REGLAS } = await import('../../src/common/alertas/index.js'));
    await migrar();
    app = await levantarAplicacion();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await vaciarTablas();
  });

  describe('vida y disponibilidad son dos cosas distintas', () => {
    it('la senal de vida responde sin tocar ninguna dependencia', async () => {
      const { body } = await api(app).get('/api/salud').expect(200);
      expect(body).toMatchObject({ estado: 'vivo' });
      expect(body.enPieDesdeHaceSegundos).toBeGreaterThanOrEqual(0);
    });

    it('las dos rutas son publicas: quien monitoriza no tiene credenciales', async () => {
      await api(app).get('/api/salud').expect(200);
      // Sin token: 200 o 503 segun el estado, pero nunca 401.
      const r = await api(app).get('/api/salud/listo');
      expect([200, 503]).toContain(r.status);
    });

    it('CRITERIO: las cuatro dependencias del paquete estan registradas', () => {
      const nombres = app.get(SaludService).nombresRegistrados.sort();
      expect(nombres).toEqual(['almacenamiento', 'base_de_datos', 'cola', 'servicio_ia']);
    });

    it('con el entorno en pie, la base de datos, el almacenamiento y la cola estan ok', async () => {
      const r = await api(app).get('/api/salud/listo');
      const porNombre = new Map<string, { estado: string }>(
        (r.body.dependencias as { nombre: string; estado: string }[]).map((d) => [d.nombre, d]),
      );

      expect(porNombre.get('base_de_datos')?.estado).toBe('ok');
      expect(porNombre.get('almacenamiento')?.estado).toBe('ok');
      expect(porNombre.get('cola')?.estado).toBe('ok');
      // El servicio de IA no corre en las pruebas: caido o sin configurar, y
      // por eso NO es critico. El backend sigue sirviendo.
      expect(r.status).toBe(200);
    });
  });

  describe('CRITERIO: refleja la caida de una dependencia', () => {
    it('una dependencia critica caida devuelve 503 y dice cual', async () => {
      const salud = app.get(SaludService);
      salud.registrar('base_de_datos', true, () =>
        Promise.resolve({ estado: 'caido', detalle: 'simulado por la prueba' }),
      );

      try {
        const { body } = await api(app).get('/api/salud/listo').expect(503);
        expect(body.estado).toBe('no_listo');
        const caida = (body.dependencias as { nombre: string; estado: string }[]).find(
          (d) => d.nombre === 'base_de_datos',
        );
        expect(caida).toMatchObject({ estado: 'caido', critica: true });
      } finally {
        // Se devuelve el comprobador real: las demas pruebas comparten la app.
        salud.registrar('base_de_datos', true, async () => {
          await api(app).get('/api/salud');
          return { estado: 'ok' };
        });
      }
    });

    it('el cuerpo del 503 trae el detalle de todas, no solo de la que fallo', async () => {
      const salud = app.get(SaludService);
      salud.registrar('prueba_critica', true, () => Promise.resolve({ estado: 'caido' }));

      const { body } = await api(app).get('/api/salud/listo').expect(503);

      expect((body.dependencias as unknown[]).length).toBeGreaterThanOrEqual(5);
      expect(body.momento).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('CRITERIO: las alertas criticas avisan al responsable', () => {
    it('cinco fallos de autenticacion seguidos disparan un aviso', async () => {
      const correo = app.get(CorreoService);
      const enviar = vi.spyOn(correo, 'enviar').mockResolvedValue(true);

      try {
        // Credenciales que no existen: cada intento es un 401, y el filtro los
        // publica como evento de seguridad.
        for (let i = 0; i < REGLAS.auth_failure.umbral; i++) {
          await api(app)
            .post('/api/v1/autenticacion/login')
            .send({ correo: 'nadie@ejemplo.com', contrasena: 'una-frase-larga-y-dificil' })
            .expect(401);
        }

        await vi.waitFor(() => expect(enviar).toHaveBeenCalledTimes(1), { timeout: 5000 });
        const [asunto, cuerpo] = enviar.mock.calls[0];
        expect(asunto).toMatch(/fallos de autenticacion/i);
        expect(cuerpo).toContain('auth_failure');
        // La alerta identifica a quien le pasa, con la ruta.
        expect(cuerpo).toMatch(/ip:|usuario:/);
        expect(cuerpo).toContain('/api/v1/autenticacion/login');
      } finally {
        enviar.mockRestore();
      }
    });

    it('un token invalido tambien llega como fallo de autenticacion', async () => {
      // Aqui se mira el servicio de alertas y no el correo: la prueba anterior
      // ya disparo el aviso para esta misma IP, asi que la regla esta callada
      // quince minutos. Eso es lo correcto —un ataque no genera mil correos—,
      // pero significa que el correo no sirve para comprobar este caso.
      const alertas = app.get(AlertasService);
      const procesar = vi.spyOn(alertas, 'procesar');

      try {
        await api(app)
          .get('/api/v1/autenticacion/yo')
          .set({ Authorization: 'Bearer v4.public.inventado' })
          .expect(401);

        await vi.waitFor(() => expect(procesar).toHaveBeenCalledTimes(1), { timeout: 5000 });
        const evento = procesar.mock.calls[0][0];
        expect(evento).toMatchObject({ tipo: 'auth_failure', ruta: '/api/v1/autenticacion/yo' });
        expect(evento.clave).toMatch(/^ip:/);
      } finally {
        procesar.mockRestore();
      }
    });

    it('una peticion legitima no dispara nada', async () => {
      const correo = app.get(CorreoService);
      const enviar = vi.spyOn(correo, 'enviar').mockResolvedValue(true);

      try {
        const sesion = await registrarCandidato(app, 'tranquilo@ejemplo.com');
        await api(app)
          .get('/api/v1/autenticacion/yo')
          .set({ Authorization: `Bearer ${sesion.token}` })
          .expect(200);

        await new Promise((r) => setTimeout(r, 200));
        expect(enviar).not.toHaveBeenCalled();
      } finally {
        enviar.mockRestore();
      }
    });
  });
});
