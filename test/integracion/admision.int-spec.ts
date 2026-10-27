import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import { api, levantarAplicacion } from './ayudas.js';

/**
 * Control de admision (P1 de docs/rendimiento.md).
 *
 * El tope se fija en 0 ANTES de levantar la aplicacion, asi que toda peticion
 * que no sea de salud se rechaza. Es deterministico: la alternativa seria
 * provocar una carrera entre peticiones concurrentes para ver un rechazo, y en
 * esta sesion ya se arreglaron cuatro pruebas que pasaban por azar.
 *
 * Que el trafico normal SI pasa lo prueban las otras once suites de
 * integracion: corren con el tope por omision y ninguna recibe un 503.
 */
describe('integracion: control de admision', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    await prepararEntorno();
    // Antes de levantarAplicacion: el servicio lee el tope al construirse.
    process.env.ADMISION_MAXIMO_EN_VUELO = '0';
    await migrar();
    await vaciarTablas();
    app = await levantarAplicacion();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.ADMISION_MAXIMO_EN_VUELO;
  });

  describe('CRITERIO RNF-4: pasado el tope se rechaza explicitamente', () => {
    it('responde 503 con el codigo y la forma de error del proyecto', async () => {
      const { body } = await api(app).get('/api/v1/vacantes').expect(503);

      expect(body).toMatchObject({ estado: 503, codigo: 'SERVICIO_SATURADO' });
      expect(body.ruta).toBe('/api/v1/vacantes');
      expect(String(body.referencia)).toMatch(/^[0-9a-f-]{36}$/);
      // La misma forma que cualquier otro error de la API (paquete 2.4): nada
      // de trazas ni de detalle del interior.
      expect(Object.keys(body).sort()).toEqual(
        ['codigo', 'estado', 'mensaje', 'momento', 'referencia', 'ruta'].sort(),
      );
    });

    it('incluye Retry-After, que es lo que evita el reintento inmediato', async () => {
      const r = await api(app).get('/api/v1/vacantes').expect(503);
      expect(r.headers['retry-after']).toBe('1');
    });

    it('rechaza ANTES de autenticar: no gasta la verificacion del token', async () => {
      // Sin cabecera de autorizacion la respuesta seria 401 si el guardia
      // corriera primero. Que sea 503 demuestra que el rechazo ocurre antes,
      // que es el punto: rechazar caro no protege nada.
      await api(app).get('/api/v1/entregas/mias').expect(503);
    });

    it('rechaza tambien lo que no existe, sin llegar al enrutador', async () => {
      await api(app).get('/api/v1/ruta-que-no-existe').expect(503);
    });
  });

  describe('las rutas de salud nunca se rechazan', () => {
    it('la senal de vida sigue respondiendo 200 bajo saturacion', async () => {
      // Si devolviera 503, el orquestador reiniciaria el contenedor justo
      // cuando esta trabajando al maximo y tiraria todo lo que tiene en vuelo.
      const { body } = await api(app).get('/api/salud').expect(200);
      expect(body).toMatchObject({ estado: 'vivo' });
    });

    it('la de disponibilidad tambien, y su respuesta es la suya', async () => {
      const r = await api(app).get('/api/salud/listo');
      expect([200, 503]).toContain(r.status);
      // La clave: si responde 503 es por una dependencia caida, no por
      // admision. Se distingue porque trae el detalle por dependencia.
      expect(r.body.dependencias).toBeDefined();
      expect(r.body.codigo).not.toBe('SERVICIO_SATURADO');
    });
  });
});
