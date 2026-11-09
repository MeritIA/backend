import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import {
  api,
  consultar,
  crearConRol,
  levantarAplicacion,
  registrarCandidato,
  type Sesion,
} from './ayudas.js';

/**
 * Mentor IA: el resumen que se le entrega a la IA y las puertas de acceso.
 *
 * El servicio de IA no esta configurado en estas pruebas, asi que lo que se
 * comprueba es todo lo que pasa ANTES de hablar con el: quien puede entrar, que
 * resumen se arma y que el permiso se hace cumplir.
 */
describe('integracion: mentor', () => {
  let app: INestApplication<Server>;
  let candidato: Sesion;
  let reclutador: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  const sembrar = async (
    idCandidato: string,
    nota: number,
    criterios: [string, number, number][],
  ) => {
    const [{ id }] = await consultar<{ id: string }>(
      `insert into evaluacion.evaluaciones (id_entrega, id_vacante, id_candidato, id_empresa, id_ejercicio,
         id_version, nota_final, proveedor, modelo, archivos, riesgo_inyeccion, creada_en)
       values (gen_random_uuid(), gen_random_uuid(), $1, gen_random_uuid(), gen_random_uuid(),
         gen_random_uuid(), $2, 'gemini', 'm', 1, 'ninguno', now()) returning id`,
      [idCandidato, nota],
    );
    for (const [i, [nombre, puntaje, escala]] of criterios.entries()) {
      await consultar(
        `insert into evaluacion.calificaciones_criterio
           (id_evaluacion, orden, criterio, puntaje, escala_maxima, peso, evidencia)
         values ($1, $2, $3, $4, $5, 50, $6)`,
        [id, i + 1, nombre, puntaje, escala, `evidencia de ${nombre}`.padEnd(400, '.')],
      );
    }
  };

  const urlDeIa = process.env.AI_SERVICE_URL;

  beforeAll(async () => {
    // Un puerto sin nadie: la prueba no depende de que haya un servicio de IA
    // levantado en la maquina que la corre.
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:1';
    await prepararEntorno();
    await migrar();
    app = await levantarAplicacion();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (urlDeIa === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = urlDeIa;
  });

  beforeEach(async () => {
    await vaciarTablas();
    candidato = await registrarCandidato(app, 'ana@cand.com');
    reclutador = await crearConRol(app, 'rita@acme.com', 'reclutador', 'Acme');
  });

  it('es solo del candidato: un reclutador recibe 403', async () => {
    await api(app).get('/api/v1/mentor/contexto').set(auth(reclutador)).expect(403);
    await api(app)
      .post('/api/v1/mentor/preguntar')
      .set(auth(reclutador))
      .send({ pregunta: 'hola', historial: [] })
      .expect(403);
    await api(app).get('/api/v1/mentor/contexto').expect(401);
  });

  it('sin evaluaciones, el resumen va vacio y la pregunta se contesta sin llamar a la IA', async () => {
    const { body } = await api(app).get('/api/v1/mentor/contexto').set(auth(candidato)).expect(200);
    expect(body).toEqual({ totalEvaluaciones: 0, promedio: 0, perfil: [], recientes: [] });

    const r = await api(app)
      .post('/api/v1/mentor/preguntar')
      .set(auth(candidato))
      .send({ pregunta: 'que mejoro?', historial: [] })
      .expect(200);
    expect(r.body.respuesta).toMatch(/Todavia no tienes evaluaciones/);
  });

  it('el resumen trae promedio por criterio y el criterio mas flojo, sin evidencia larga', async () => {
    await sembrar(candidato.id, 80, [
      ['Correccion', 4, 5],
      ['Claridad', 3, 10],
    ]);
    await sembrar(candidato.id, 60, [
      ['Correccion', 3, 5],
      ['Claridad', 3, 10],
    ]);

    const { body } = await api(app).get('/api/v1/mentor/contexto').set(auth(candidato)).expect(200);
    expect(body.totalEvaluaciones).toBe(2);
    expect(body.promedio).toBe(70);
    expect(body.perfil).toContainEqual({ nombre: 'Claridad', porcentaje: 30, veces: 2 });
    expect(body.perfil).toContainEqual({ nombre: 'Correccion', porcentaje: 70, veces: 2 });
    expect(body.recientes[0].flojo.criterio).toBe('Claridad');
    expect(body.recientes[0].flojo.evidencia.length).toBeLessThanOrEqual(160);
    // Nada que identifique a la persona ni a la empresa.
    expect(JSON.stringify(body)).not.toMatch(/ana@cand|Acme/);
  });

  it('no cuenta las evaluaciones de otro candidato', async () => {
    const otro = await registrarCandidato(app, 'luis@cand.com');
    await sembrar(otro.id, 90, [['Correccion', 5, 5]]);
    const { body } = await api(app).get('/api/v1/mentor/contexto').set(auth(candidato)).expect(200);
    expect(body.totalEvaluaciones).toBe(0);
  });

  it('revocar la calificacion por IA bloquea al mentor con 403', async () => {
    await sembrar(candidato.id, 80, [['Correccion', 4, 5]]);
    await api(app)
      .put('/api/v1/autenticacion/consentimientos')
      .set(auth(candidato))
      .send({ decisiones: [{ tipo: 'calificacion_ia', concedido: false }], origen: 'perfil' })
      .expect(200);
    const r = await api(app)
      .post('/api/v1/mentor/preguntar')
      .set(auth(candidato))
      .send({ pregunta: 'que mejoro?', historial: [] })
      .expect(403);
    expect(JSON.stringify(r.body)).toMatch(/calificacion por IA/);
  });

  it('con evaluaciones y el servicio de IA caido responde 503, no un error opaco', async () => {
    await sembrar(candidato.id, 80, [['Correccion', 4, 5]]);
    await api(app)
      .post('/api/v1/mentor/preguntar')
      .set(auth(candidato))
      .send({ pregunta: 'que mejoro?', historial: [] })
      .expect(503);
  });

  it('valida la pregunta', async () => {
    await api(app)
      .post('/api/v1/mentor/preguntar')
      .set(auth(candidato))
      .send({ pregunta: 'x'.repeat(501), historial: [] })
      .expect(400);
  });
});
