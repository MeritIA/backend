import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import { api, consultar, levantarAplicacion } from './ayudas.js';

/** Pantalla A01: una empresa se da de alta sola, con su primer administrador. */
describe('integracion: auto-registro de empresa', () => {
  let app: INestApplication<Server>;

  const cuerpo = {
    nombreEmpresa: 'Acme S.A.S.',
    sector: 'financiero',
    nit: '890903938-8',
    correo: 'ana@acme.com',
    contrasena: 'una-frase-larga-y-dificil',
    nombreCompleto: 'Ana Maria Torres',
  };

  beforeAll(async () => {
    await prepararEntorno();
    await migrar();
    app = await levantarAplicacion();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await vaciarTablas();
  });

  it('crea la empresa y un administrador que ya puede operar', async () => {
    const res = await api(app)
      .post('/api/v1/autenticacion/registro-empresa')
      .send(cuerpo)
      .expect(201);
    expect(res.body.rol).toBe('administrador');

    const filas = await consultar<{ rol: string; nombre: string }>(
      `select u.rol, e.nombre from autenticacion.usuarios u
         join autenticacion.empresas e on e.id = u.id_empresa`,
    );
    expect(filas).toEqual([{ rol: 'administrador', nombre: 'Acme S.A.S.' }]);
  });

  it('rechaza un NIT que no cuadra con su digito de verificacion', async () => {
    await api(app)
      .post('/api/v1/autenticacion/registro-empresa')
      .send({ ...cuerpo, nit: '890903938-1' })
      .expect(400);
  });

  it('no repite NIT ni correo, y no deja una empresa huerfana', async () => {
    await api(app).post('/api/v1/autenticacion/registro-empresa').send(cuerpo).expect(201);
    await api(app)
      .post('/api/v1/autenticacion/registro-empresa')
      .send({ ...cuerpo, nombreEmpresa: 'Otra', correo: 'otra@acme.com' })
      .expect(409);
    await api(app)
      .post('/api/v1/autenticacion/registro-empresa')
      .send({ ...cuerpo, correo: 'tres@acme.com', nit: '899999068-1' })
      .expect(409);
    const [{ n }] = await consultar<{ n: string }>(
      'select count(*)::text n from autenticacion.empresas',
    );
    expect(n).toBe('1');
  });
});
