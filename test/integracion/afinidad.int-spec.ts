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
 * El % de afinidad (B13, A04) contra datos reales.
 *
 * Lo que prueba y lo que no: aqui NO se llama a la IA. Las calificaciones por
 * criterio se escriben directamente, que es lo que el evaluador habria dejado,
 * porque lo que se comprueba es el calculo de afinidad sobre ellas y no la
 * calidad de la nota. La calificacion con el modelo real tiene su propia suite
 * de calibracion en el servicio de IA.
 */
describe('integracion: afinidad y perfil de habilidades', () => {
  let app: INestApplication<Server>;
  let reclutador: Sesion;
  let candidato: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });
  let contador = 0;

  /** Un ejercicio con los criterios que se le pasen, y su peso. */
  async function ejercicioCon(criterios: { nombre: string; peso: number }[]): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/ejercicios')
      .set(auth(reclutador))
      .send({
        titulo: `Ejercicio ${++contador}`,
        enunciado: 'Enunciado de prueba suficientemente largo para pasar la validacion del DTO.',
        criterios: criterios.map((c) => ({
          nombre: c.nombre,
          descripcion: 'Descripcion del criterio, con largo suficiente para el DTO.',
          peso: c.peso,
          escalaMaxima: 5,
        })),
      })
      .expect(201);
    return body.id as string;
  }

  async function vacanteCon(idsDeEjercicios: string[]): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(reclutador))
      .send({
        titulo: `Vacante ${++contador}`,
        descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
      })
      .expect(201);
    const id = body.id as string;
    await api(app)
      .put(`/api/v1/vacantes/${id}/ejercicios`)
      .set(auth(reclutador))
      .send({ idsDeEjercicios })
      .expect(200);
    await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(200);
    return id;
  }

  /**
   * Deja una calificacion por criterio para el candidato.
   *
   * Pasa por SQL y no por la cola: encolar gastaria cuota real del proveedor
   * para comprobar una media ponderada. Es la misma razon por la que el script
   * de siembra lo hace asi.
   */
  async function calificar(
    quien: Sesion,
    idVacante: string,
    idEjercicio: string,
    notas: { criterio: string; puntaje: number }[],
  ): Promise<void> {
    const [{ id_empresa: idEmpresa }] = await consultar<{ id_empresa: string }>(
      `select id_empresa from autenticacion.usuarios where id = $1`,
      [reclutador.id],
    );
    const [evaluacion] = await consultar<{ id: string }>(
      `insert into evaluacion.evaluaciones
         (id_entrega, id_vacante, id_candidato, id_empresa, id_ejercicio, id_version,
          nota_final, proveedor, modelo, archivos, riesgo_inyeccion, creada_en)
       values (gen_random_uuid(), $1, $2, $3, $4, gen_random_uuid(),
               80, 'gemini', 'gemini-3.5-flash', 1, 'ninguno', now())
       returning id`,
      [idVacante, quien.id, idEmpresa, idEjercicio],
    );
    for (const [orden, nota] of notas.entries()) {
      await consultar(
        `insert into evaluacion.calificaciones_criterio
           (id_evaluacion, orden, criterio, puntaje, escala_maxima, peso, evidencia)
         values ($1, $2, $3, $4, 5, 50, 'Evidencia de prueba.')`,
        [evaluacion.id, orden, nota.criterio, nota.puntaje],
      );
    }
  }

  const afinidadDe = async (idVacante: string) => {
    const { body } = await api(app)
      .get('/api/v1/reportes/afinidad')
      .set(auth(candidato))
      .expect(200);
    return body.find((o: { id: string }) => o.id === idVacante);
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
    reclutador = await crearConRol(app, 'recl@ejemplo.com', 'reclutador');
    candidato = await registrarCandidato(app, 'cand@ejemplo.com');
    contador = 0;
  }, 60_000);

  describe('sin pruebas resueltas no hay numero, y no es cero', () => {
    it('un candidato nuevo tiene afinidad desconocida, no 0 %', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);

      const oferta = await afinidadDe(idVacante);
      // Un cero diria "no encajas" a quien no ha tenido oportunidad de
      // demostrar nada.
      expect(oferta.afinidad.porcentaje).toBeNull();
      expect(oferta.afinidad.cobertura).toBe(0);
    });

    it('su perfil de habilidades esta vacio, sin inventar nada', async () => {
      const { body } = await api(app)
        .get('/api/v1/reportes/mi-perfil-de-habilidades')
        .set(auth(candidato))
        .expect(200);
      expect(body).toEqual([]);
    });
  });

  describe('la afinidad sale de pruebas resueltas y calificadas', () => {
    it('un buen resultado en el criterio que la vacante pide da afinidad alta', async () => {
      const idEjercicio = await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]);
      const idVacante = await vacanteCon([idEjercicio]);
      // 5 de 5 en el unico criterio que se pide.
      await calificar(candidato, idVacante, idEjercicio, [
        { criterio: 'Correccion funcional', puntaje: 5 },
      ]);

      const oferta = await afinidadDe(idVacante);
      expect(oferta.afinidad.porcentaje).toBe(100);
      expect(oferta.afinidad.cobertura).toBe(100);
    });

    it('un mal resultado da afinidad baja, con el mismo desglose', async () => {
      const idEjercicio = await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]);
      const idVacante = await vacanteCon([idEjercicio]);
      await calificar(candidato, idVacante, idEjercicio, [
        { criterio: 'Correccion funcional', puntaje: 1 },
      ]);

      const oferta = await afinidadDe(idVacante);
      expect(oferta.afinidad.porcentaje).toBe(20);
      expect(oferta.afinidad.criterios[0]).toMatchObject({
        nombre: 'Correccion funcional',
        nivel: 20,
        veces: 1,
      });
    });

    it('el nivel es puntaje/escala: dos calificaciones se promedian', async () => {
      const idEjercicio = await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]);
      const idVacante = await vacanteCon([idEjercicio]);
      await calificar(candidato, idVacante, idEjercicio, [
        { criterio: 'Correccion funcional', puntaje: 5 },
      ]);
      await calificar(candidato, idVacante, idEjercicio, [
        { criterio: 'Correccion funcional', puntaje: 1 },
      ]);

      const oferta = await afinidadDe(idVacante);
      expect(oferta.afinidad.porcentaje).toBe(60);
      expect(oferta.afinidad.criterios[0].veces).toBe(2);
    });

    it('la evidencia de OTRA vacante tambien cuenta: el perfil es transversal', async () => {
      // Esto es lo que hace que la afinidad sirva: lo que demostraste en una
      // empresa vale para la siguiente.
      const idEjercicio = await ejercicioCon([{ nombre: 'Modelado de datos', peso: 100 }]);
      const vieja = await vacanteCon([idEjercicio]);
      await calificar(candidato, vieja, idEjercicio, [
        { criterio: 'Modelado de datos', puntaje: 4 },
      ]);

      // Una vacante NUEVA que pide lo mismo, sin que el candidato la haya tocado.
      const otroEjercicio = await ejercicioCon([{ nombre: 'Modelado de datos', peso: 100 }]);
      const nueva = await vacanteCon([otroEjercicio]);

      const oferta = await afinidadDe(nueva);
      expect(oferta.afinidad.porcentaje).toBe(80);
    });
  });

  describe('la cobertura delata un numero sostenido por poca evidencia', () => {
    it('evidencia de la mitad de la rubrica da cobertura del 50 %', async () => {
      const idEjercicio = await ejercicioCon([
        { nombre: 'Correccion funcional', peso: 50 },
        { nombre: 'Claridad del codigo', peso: 50 },
      ]);
      const idVacante = await vacanteCon([idEjercicio]);
      await calificar(candidato, idVacante, idEjercicio, [
        { criterio: 'Correccion funcional', puntaje: 5 },
      ]);

      const oferta = await afinidadDe(idVacante);
      // 100 % de lo que se sabe, y se sabe la mitad. Los dos numeros juntos.
      expect(oferta.afinidad.porcentaje).toBe(100);
      expect(oferta.afinidad.cobertura).toBe(50);

      const sinEvidencia = oferta.afinidad.criterios.find(
        (c: { nombre: string }) => c.nombre === 'Claridad del codigo',
      );
      expect(sinEvidencia).toMatchObject({ nivel: null, veces: 0 });
    });
  });

  describe('la afinidad ordena, NUNCA esconde', () => {
    it('una oferta con afinidad desconocida sigue en el catalogo', async () => {
      // La decision mas importante del ADR-0016: un algoritmo que decide que
      // ofertas ve una persona es el sesgo que la auditoria de equidad vigila.
      const conAfinidad = await (async () => {
        const e = await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]);
        const v = await vacanteCon([e]);
        await calificar(candidato, v, e, [{ criterio: 'Correccion funcional', puntaje: 5 }]);
        return v;
      })();
      const sinNadaEnComun = await vacanteCon([
        await ejercicioCon([{ nombre: 'Algo que nunca hizo', peso: 100 }]),
      ]);

      const { body } = await api(app)
        .get('/api/v1/reportes/afinidad')
        .set(auth(candidato))
        .expect(200);

      expect(body).toHaveLength(2);
      expect(body.map((o: { id: string }) => o.id)).toContain(sinNadaEnComun);
      expect(body.map((o: { id: string }) => o.id)).toContain(conAfinidad);
    });

    it('quien no tiene evidencia sale ARRIBA: es quien mas necesita encontrar ofertas', async () => {
      const e = await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]);
      const conocida = await vacanteCon([e]);
      await calificar(candidato, conocida, e, [{ criterio: 'Correccion funcional', puntaje: 5 }]);
      const desconocida = await vacanteCon([
        await ejercicioCon([{ nombre: 'Algo que nunca hizo', peso: 100 }]),
      ]);

      const { body } = await api(app)
        .get('/api/v1/reportes/afinidad')
        .set(auth(candidato))
        .expect(200);
      expect(body[0].id).toBe(desconocida);
      expect(body[0].afinidad.porcentaje).toBeNull();
    });

    it('entre dos conocidas, la mayor primero', async () => {
      const buena = await ejercicioCon([{ nombre: 'Habilidad fuerte', peso: 100 }]);
      const mala = await ejercicioCon([{ nombre: 'Habilidad floja', peso: 100 }]);
      const vBuena = await vacanteCon([buena]);
      const vMala = await vacanteCon([mala]);
      await calificar(candidato, vBuena, buena, [{ criterio: 'Habilidad fuerte', puntaje: 5 }]);
      await calificar(candidato, vMala, mala, [{ criterio: 'Habilidad floja', puntaje: 1 }]);

      const { body } = await api(app)
        .get('/api/v1/reportes/afinidad')
        .set(auth(candidato))
        .expect(200);
      expect(body[0].id).toBe(vBuena);
      expect(body[1].id).toBe(vMala);
    });
  });

  describe('el catalogo con afinidad sigue siendo el catalogo', () => {
    it('no ensena borradores ni cerradas, igual que /vacantes/abiertas', async () => {
      const { body: borrador } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Sin publicar', descripcion: 'Todavia se esta redactando y nadie la ve.' })
        .expect(201);

      const { body } = await api(app)
        .get('/api/v1/reportes/afinidad')
        .set(auth(candidato))
        .expect(200);
      expect(body.map((o: { id: string }) => o.id)).not.toContain(borrador.id);
    });

    it('trae lo del catalogo: si ya se postulo y si ya esta invitado', async () => {
      const idVacante = await vacanteCon([
        await ejercicioCon([{ nombre: 'Correccion funcional', peso: 100 }]),
      ]);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/postular`)
        .set(auth(candidato))
        .expect(201);

      const oferta = await afinidadDe(idVacante);
      expect(oferta.miPostulacion).toBe('en_revision');
      expect(oferta.yaInvitado).toBe(false);
    });
  });

  describe('el perfil es del candidato y de nadie mas', () => {
    it('un reclutador no puede pedir el catalogo con afinidad ni un perfil', async () => {
      await api(app).get('/api/v1/reportes/afinidad').set(auth(reclutador)).expect(403);
      await api(app)
        .get('/api/v1/reportes/mi-perfil-de-habilidades')
        .set(auth(reclutador))
        .expect(403);
    });

    it('el perfil de uno no contiene las habilidades de otro', async () => {
      const otro = await registrarCandidato(app, 'otro@ejemplo.com');
      const idEjercicio = await ejercicioCon([{ nombre: 'Solo del otro', peso: 100 }]);
      const idVacante = await vacanteCon([idEjercicio]);
      await calificar(otro, idVacante, idEjercicio, [{ criterio: 'Solo del otro', puntaje: 5 }]);

      const { body } = await api(app)
        .get('/api/v1/reportes/mi-perfil-de-habilidades')
        .set(auth(candidato))
        .expect(200);
      expect(body).toEqual([]);

      // Y el del otro si lo tiene: no es que no se guardara.
      const { body: delOtro } = await api(app)
        .get('/api/v1/reportes/mi-perfil-de-habilidades')
        .set(auth(otro))
        .expect(200);
      expect(delOtro).toHaveLength(1);
      expect(delOtro[0]).toMatchObject({ nombre: 'Solo del otro', nivel: 100, veces: 1 });
    });
  });

  describe('varios ejercicios en una vacante', () => {
    it('cada ejercicio aporta lo mismo, aunque uno tenga mas criterios', async () => {
      const detallado = await ejercicioCon([
        { nombre: 'Detalle A', peso: 25 },
        { nombre: 'Detalle B', peso: 25 },
        { nombre: 'Detalle C', peso: 25 },
        { nombre: 'Detalle D', peso: 25 },
      ]);
      const simple = await ejercicioCon([{ nombre: 'Lo unico', peso: 100 }]);
      const idVacante = await vacanteCon([detallado, simple]);

      // Perfecto en el ejercicio simple, nada del detallado.
      await calificar(candidato, idVacante, simple, [{ criterio: 'Lo unico', puntaje: 5 }]);

      const oferta = await afinidadDe(idVacante);
      expect(oferta.afinidad.porcentaje).toBe(100);
      // La mitad del peso de la vacante, porque son dos ejercicios.
      expect(oferta.afinidad.cobertura).toBe(50);
    });
  });
});
