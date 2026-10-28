import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import {
  api,
  consultar,
  crearConRol,
  crearEjercicioEnElBanco,
  levantarAplicacion,
  registrarCandidato,
  uuid,
  type Sesion,
} from './ayudas.js';
import type { CorreoService as TipoCorreo } from '../../src/common/alertas/index.js';

/**
 * Avisos por correo al cerrar una vacante, contra PostgreSQL de verdad.
 *
 * LA DECISION QUE SE COMPRUEBA AQUI (27/10/2026, D-10): cerrar una vacante
 * avisa por correo a quienes participaron, el correo no lleva la nota ni el
 * puesto, y nadie recibe el mismo aviso dos veces.
 *
 * NO SE MANDA CORREO DE VERDAD: se sustituye el envio de CorreoService, que es
 * la unica pieza que habla SMTP. Lo que se prueba es todo lo demas —a quien se
 * le escribe, que dice el texto, y que no se repita—, que es justamente lo que
 * no se puede comprobar mirando una bandeja de entrada.
 *
 * Las evaluaciones se siembran con SQL: el camino de la cola y del servicio de
 * IA ya tiene sus pruebas en evaluacion.int-spec, y repetirlo aqui mediria lo
 * mismo dos veces.
 */
describe('integracion: avisos por correo al cerrar una vacante', () => {
  let app: INestApplication<Server>;
  let correo: TipoCorreo;
  let enviarA: ReturnType<typeof vi.spyOn>;

  let reclutador: Sesion;
  let reclutadorDeOtraEmpresa: Sesion;
  let ana: Sesion;
  let luis: Sesion;
  let sinEntregar: Sesion;

  let idVacante: string;
  let idEjercicio: string;
  let idEmpresa: string;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  beforeAll(async () => {
    await prepararEntorno();
    // El canal arranca apagado en el resto del proyecto, a proposito. Esta
    // suite es la que prueba el envio, asi que lo enciende antes de construir
    // la aplicacion: el servicio lee el entorno en su constructor.
    process.env.NOTIFICACIONES_A_CANDIDATOS = 'true';
    process.env.URL_PLATAFORMA = 'https://app.meritia.local';
    await migrar();
    app = await levantarAplicacion();

    const { CorreoService } = await import('../../src/common/alertas/index.js');
    correo = app.get(CorreoService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.NOTIFICACIONES_A_CANDIDATOS;
    delete process.env.URL_PLATAFORMA;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Siembra una evaluacion, como la dejaria el paquete 4.5. */
  async function sembrarEvaluacion(idCandidato: string, notaFinal = 72): Promise<void> {
    await consultar(
      `insert into evaluacion.evaluaciones
         (id_entrega, id_vacante, id_candidato, id_empresa, id_ejercicio, id_version,
          nota_final, proveedor, modelo, archivos, riesgo_inyeccion, creada_en)
       values ($1, $2, $3, $4, $5, $6, $7, 'gemini', 'gemini-3.5-flash', 1, 'ninguno', now())`,
      [uuid(), idVacante, idCandidato, idEmpresa, idEjercicio, uuid(), notaFinal],
    );
  }

  async function filasDeAvisos(): Promise<
    { id_candidato: string; estado: string; intentos: number; enviado_en: Date | null }[]
  > {
    return consultar(
      `select id_candidato, estado, intentos, enviado_en
         from notificaciones.avisos where id_vacante = $1 order by creado_en`,
      [idVacante],
    );
  }

  /**
   * Espera a que haya `cuantos` avisos y todos en estado final.
   *
   * Esperar solo a que existan las filas no basta y se nota: la fila se crea
   * antes de intentar el envio, asi que una prueba que siguiera ahi contaba
   * correos que todavia estaban saliendo y los sumaba a los de la prueba
   * siguiente. El bus entrega en segundo plano y esto es lo que lo espera.
   */
  async function esperarAvisos(cuantos: number, estado = 'enviada'): Promise<void> {
    await vi.waitFor(
      async () => {
        const filas = await filasDeAvisos();
        expect(filas).toHaveLength(cuantos);
        expect(filas.map((f) => f.estado)).toEqual(Array(cuantos).fill(estado));
      },
      { timeout: 5000, interval: 50 },
    );
  }

  const cerrar = () =>
    api(app).post(`/api/v1/vacantes/${idVacante}/cerrar`).set(auth(reclutador)).expect(200);

  beforeEach(async () => {
    await vaciarTablas();
    // Por omision, el envio "sale bien" sin tocar SMTP. Cada prueba que quiera
    // otro resultado lo cambia.
    enviarA = vi.spyOn(correo, 'enviarA').mockResolvedValue('enviado');

    reclutador = await crearConRol(app, 'laura@empresa-a.com', 'reclutador', 'Empresa A');
    reclutadorDeOtraEmpresa = await crearConRol(
      app,
      'otro@empresa-b.com',
      'reclutador',
      'Empresa B',
    );
    ana = await registrarCandidato(app, 'ana@ejemplo.com', 'Ana Maria Rojas');
    luis = await registrarCandidato(app, 'luis@ejemplo.com', 'Luis Perez');
    sinEntregar = await registrarCandidato(app, 'nadie@ejemplo.com', 'Pedro Sin Entrega');

    idEjercicio = await crearEjercicioEnElBanco(app, reclutador, `Ejercicio ${uuid()}`);

    const { body: vacante } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(reclutador))
      .send({
        titulo: 'Desarrollador backend junior',
        descripcion: 'Buscamos una persona para el equipo de plataforma.',
      })
      .expect(201);
    idVacante = vacante.id as string;

    await api(app)
      .put(`/api/v1/vacantes/${idVacante}/ejercicios`)
      .set(auth(reclutador))
      .send({ idsDeEjercicios: [idEjercicio] })
      .expect(200);
    await api(app).post(`/api/v1/vacantes/${idVacante}/publicar`).set(auth(reclutador)).expect(200);

    const [fila] = await consultar<{ id_empresa: string }>(
      'select id_empresa from vacantes.vacantes where id = $1',
      [idVacante],
    );
    idEmpresa = fila.id_empresa;
  }, 60_000);

  describe('CRITERIO: cerrar la vacante avisa a quienes participaron', () => {
    beforeEach(async () => {
      await sembrarEvaluacion(ana.id, 88);
      await sembrarEvaluacion(ana.id, 55); // segundo intento: un aviso, no dos
      await sembrarEvaluacion(luis.id, 72);
    });

    it('escribe a cada participante una sola vez, y a nadie mas', async () => {
      await cerrar();

      // El bus entrega de forma asincrona: el cierre no espera al correo.
      await esperarAvisos(2);

      const filas = await filasDeAvisos();
      expect(filas.map((f) => f.id_candidato).sort()).toEqual([ana.id, luis.id].sort());
      expect(filas.every((f) => f.estado === 'enviada')).toBe(true);
      expect(filas.every((f) => f.enviado_en !== null)).toBe(true);

      // Dos intentos de Ana, un solo correo: el aviso es por persona.
      expect(enviarA).toHaveBeenCalledTimes(2);
    });

    it('NO le escribe a quien fue invitado y no entrego nada', async () => {
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: sinEntregar.id })
        .expect(200);

      await cerrar();
      await esperarAvisos(2);

      const filas = await filasDeAvisos();
      expect(filas.map((f) => f.id_candidato)).not.toContain(sinEntregar.id);
    });

    it('el correo va a la direccion del propio candidato', async () => {
      await cerrar();
      await esperarAvisos(2);

      const destinatarios = enviarA.mock.calls.map((c) => c[0] as string).sort();
      expect(destinatarios).toEqual(['ana@ejemplo.com', 'luis@ejemplo.com']);
    });

    it('el texto dice de que vacante habla y NO lleva la nota ni el puesto', async () => {
      await cerrar();
      await esperarAvisos(2);

      const [, asunto, cuerpo] = enviarA.mock.calls[0] as [string, string, string];
      expect(asunto).toContain('Desarrollador backend junior');
      expect(cuerpo).toContain('https://app.meritia.local');
      // Las notas sembradas son 88, 72 y 55. Ninguna puede aparecer.
      expect(cuerpo).not.toMatch(/88|72|55/);
      expect(cuerpo).not.toMatch(/puesto\s+\d/i);
    });

    it('el aviso de un candidato no menciona a los demas', async () => {
      await cerrar();
      await esperarAvisos(2);

      for (const llamada of enviarA.mock.calls) {
        const [destino, , cuerpo] = llamada as [string, string, string];
        const elOtro = destino.startsWith('ana') ? 'Luis' : 'Ana';
        expect(cuerpo).not.toContain(elOtro);
        expect(cuerpo).not.toContain('ejemplo.com');
      }
    });
  });

  describe('CRITERIO: nadie recibe el mismo aviso dos veces', () => {
    beforeEach(async () => {
      await sembrarEvaluacion(ana.id, 88);
      await sembrarEvaluacion(luis.id, 72);
      await cerrar();
      await esperarAvisos(2);
      enviarA.mockClear();
    });

    it('el reenvio manual no vuelve a escribir a quien ya recibio el aviso', async () => {
      const { body } = await api(app)
        .post(`/api/v1/notificaciones/vacantes/${idVacante}/reenviar`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toMatchObject({ enviados: 0, nuevos: 0, yaAvisados: 2 });
      expect(enviarA).not.toHaveBeenCalled();
    });

    it('apretar reenviar tres veces seguidas sigue sin mandar nada', async () => {
      for (let i = 0; i < 3; i++) {
        await api(app)
          .post(`/api/v1/notificaciones/vacantes/${idVacante}/reenviar`)
          .set(auth(reclutador))
          .expect(200);
      }
      expect(enviarA).not.toHaveBeenCalled();
      expect(await filasDeAvisos()).toHaveLength(2);
    });

    it('dos cierres a la vez no duplican el aviso: lo impide la base de datos', async () => {
      // La vacante ya esta cerrada, asi que el segundo cierre devuelve 400. La
      // prueba de la carrera de verdad es la de abajo, contra el servicio.
      await api(app).post(`/api/v1/vacantes/${idVacante}/cerrar`).set(auth(reclutador)).expect(400);

      const { NotificacionesService } = await import('../../src/modules/notificaciones/index.js');
      const servicio = app.get(NotificacionesService);

      // Dos rondas en paralelo sobre la misma vacante. Solo una puede reservar
      // cada fila; la otra se encuentra todo tomado.
      const [a, b] = await Promise.all([
        servicio.avisarDelCierre(idVacante),
        servicio.avisarDelCierre(idVacante),
      ]);

      expect(a.nuevos + b.nuevos).toBe(0);
      expect(a.enviados + b.enviados).toBe(0);
      expect(enviarA).not.toHaveBeenCalled();
      expect(await filasDeAvisos()).toHaveLength(2);
    });

    it('a quien se evalua despues del cierre se le avisa en el reenvio', async () => {
      const tarde = await registrarCandidato(app, 'tarde@ejemplo.com', 'Clara Tardia');
      await sembrarEvaluacion(tarde.id, 61);

      const { body } = await api(app)
        .post(`/api/v1/notificaciones/vacantes/${idVacante}/reenviar`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toMatchObject({ considerados: 3, nuevos: 1, enviados: 1, yaAvisados: 2 });
      expect(enviarA).toHaveBeenCalledTimes(1);
      expect(enviarA.mock.calls[0][0]).toBe('tarde@ejemplo.com');
    });
  });

  describe('CRITERIO: lo que no sale queda registrado y se puede reintentar', () => {
    beforeEach(async () => {
      await sembrarEvaluacion(ana.id, 88);
    });

    it('si el servidor de correo rechaza el envio, la fila queda fallida con su motivo', async () => {
      enviarA.mockResolvedValue('fallido');
      await cerrar();
      await esperarAvisos(1, 'fallida');

      const [fila] = await consultar<{ estado: string; intentos: number; ultimo_error: string }>(
        'select estado, intentos, ultimo_error from notificaciones.avisos where id_vacante = $1',
        [idVacante],
      );
      expect(fila.intentos).toBe(1);
      expect(fila.ultimo_error).toContain('rechazo el envio');
    });

    it('el reintento de lo fallido si vuelve a enviar, y suma un intento', async () => {
      enviarA.mockResolvedValue('fallido');
      await cerrar();
      await esperarAvisos(1, 'fallida');

      enviarA.mockResolvedValue('enviado');
      const { body } = await api(app)
        .post(`/api/v1/notificaciones/vacantes/${idVacante}/reenviar`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toMatchObject({ enviados: 1, nuevos: 0 });
      const [fila] = await filasDeAvisos();
      expect(fila.estado).toBe('enviada');
      expect(fila.intentos).toBe(2);
    });

    it('sin servidor de correo el aviso queda en sin_canal, no en fallida', async () => {
      // La diferencia importa: "no hay canal" es un entorno sin configurar y
      // "fallida" es un servidor que rechazo. Mezclarlas haria imposible saber
      // si reintentar tiene sentido.
      enviarA.mockResolvedValue('sin_canal');
      await cerrar();
      await esperarAvisos(1, 'sin_canal');
    });

    it('la consulta de estado lo cuenta todo y NO devuelve direcciones de correo', async () => {
      await cerrar();
      await esperarAvisos(1);

      const { body } = await api(app)
        .get(`/api/v1/notificaciones/vacantes/${idVacante}`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toHaveLength(1);
      expect(Object.keys(body[0]).sort()).toEqual([
        'enviadoEn',
        'estado',
        'idCandidato',
        'intentos',
        'tipo',
        'ultimoError',
      ]);
      expect(JSON.stringify(body)).not.toContain('ana@ejemplo.com');
      expect(JSON.stringify(body)).not.toContain('Ana Maria');
    });
  });

  describe('CRITERIO: solo la empresa dueña de la vacante ve y reintenta sus avisos', () => {
    beforeEach(async () => {
      await sembrarEvaluacion(ana.id, 88);
      await cerrar();
      await esperarAvisos(1);
    });

    it('el reclutador de otra empresa recibe 404, no 403', async () => {
      // 404 y no 403 por lo mismo que en el resto del proyecto: un 403
      // confirmaria que la vacante existe.
      await api(app)
        .get(`/api/v1/notificaciones/vacantes/${idVacante}`)
        .set(auth(reclutadorDeOtraEmpresa))
        .expect(404);
      await api(app)
        .post(`/api/v1/notificaciones/vacantes/${idVacante}/reenviar`)
        .set(auth(reclutadorDeOtraEmpresa))
        .expect(404);
    });

    it('un candidato no puede ver ni reintentar los avisos', async () => {
      await api(app).get(`/api/v1/notificaciones/vacantes/${idVacante}`).set(auth(ana)).expect(403);
      await api(app)
        .post(`/api/v1/notificaciones/vacantes/${idVacante}/reenviar`)
        .set(auth(ana))
        .expect(403);
    });

    it('sin sesion, 401', async () => {
      await api(app).get(`/api/v1/notificaciones/vacantes/${idVacante}`).expect(401);
    });

    it('una vacante que no existe da 404 y no filtra que no existe la tabla', async () => {
      await api(app)
        .get(`/api/v1/notificaciones/vacantes/${uuid()}`)
        .set(auth(reclutador))
        .expect(404);
    });
  });

  describe('CRITERIO: no se avisa de un cierre que no ocurrio', () => {
    it('reenviar sobre una vacante publicada no manda nada y dice por que', async () => {
      await sembrarEvaluacion(ana.id, 88);

      const { body } = await api(app)
        .post(`/api/v1/notificaciones/vacantes/${idVacante}/reenviar`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toMatchObject({ omitido: 'vacante_no_cerrada', enviados: 0, nuevos: 0 });
      expect(enviarA).not.toHaveBeenCalled();
      expect(await filasDeAvisos()).toHaveLength(0);
    });

    it('una vacante cerrada sin ninguna evaluacion no genera avisos', async () => {
      await cerrar();
      // Nada que esperar: se comprueba que sigue vacio despues de dar tiempo al bus.
      await new Promise((r) => setTimeout(r, 300));
      expect(await filasDeAvisos()).toHaveLength(0);
      expect(enviarA).not.toHaveBeenCalled();
    });
  });
});
