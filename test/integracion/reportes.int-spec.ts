import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
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

/**
 * Reportes consolidados (paquete 5.1), contra PostgreSQL de verdad.
 *
 * Los tres criterios del paquete: el reclutador consulta el ranking con su
 * desglose y evidencia, el reporte es util —aqui se comprueba que las cifras
 * cuadran—, y ningun reporte muestra datos de otra empresa.
 *
 * Las evaluaciones se siembran con SQL en vez de pasar por la cola y el
 * servicio de IA: ese camino ya tiene sus pruebas en evaluacion.int-spec, y
 * repetirlo aqui mediria lo mismo dos veces. Lo que se prueba en este archivo
 * es la agregacion y la frontera de empresa.
 */
describe('integracion: reportes consolidados', () => {
  let app: INestApplication<Server>;

  let reclutador: Sesion;
  let reclutadorDeOtraEmpresa: Sesion;
  let admin: Sesion;
  let ana: Sesion;
  let luis: Sesion;
  let candidatoConNombrePeligroso: Sesion;

  let idVacante: string;
  let idEjercicio: string;
  let idEmpresa: string;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  beforeAll(async () => {
    await prepararEntorno();
    await migrar();
    app = await levantarAplicacion();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  /** Siembra una evaluacion con su desglose, como la dejaria el paquete 4.5. */
  async function sembrarEvaluacion(opciones: {
    idCandidato: string;
    notaFinal: number;
    creadaEn: string;
    riesgo?: string;
    criterios?: { criterio: string; puntaje: number; escalaMaxima: number; peso: number }[];
    idVacanteDistinta?: string;
    idEmpresaDistinta?: string;
  }): Promise<string> {
    const idEntrega = uuid();
    const criterios = opciones.criterios ?? [
      { criterio: 'Correccion funcional', puntaje: 4, escalaMaxima: 5, peso: 100 },
    ];

    const [evaluacion] = await consultar<{ id: string }>(
      `insert into evaluacion.evaluaciones
         (id_entrega, id_vacante, id_candidato, id_empresa, id_ejercicio, id_version,
          nota_final, proveedor, modelo, archivos, riesgo_inyeccion, creada_en)
       values ($1, $2, $3, $4, $5, $6, $7, 'gemini', 'gemini-3.5-flash', 1, $8, $9)
       returning id`,
      [
        idEntrega,
        opciones.idVacanteDistinta ?? idVacante,
        opciones.idCandidato,
        opciones.idEmpresaDistinta ?? idEmpresa,
        idEjercicio,
        uuid(),
        opciones.notaFinal,
        opciones.riesgo ?? 'ninguno',
        opciones.creadaEn,
      ],
    );

    for (const [orden, c] of criterios.entries()) {
      await consultar(
        `insert into evaluacion.calificaciones_criterio
           (id_evaluacion, orden, criterio, puntaje, escala_maxima, peso, evidencia)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          evaluacion.id,
          orden,
          c.criterio,
          c.puntaje,
          c.escalaMaxima,
          c.peso,
          `En main.py, ${c.criterio.toLowerCase()}: resuelve el caso limite de la lista vacia.`,
        ],
      );
    }
    return evaluacion.id;
  }

  /**
   * Siembra una entrega en el estado que se pida.
   *
   * El reporte solo las cuenta, nunca lee su nombre de archivo, asi que no
   * hace falta que pase por el almacenamiento.
   */
  async function sembrarEntrega(
    idCandidato: string,
    estado: string,
    numeroIntento = 1,
  ): Promise<void> {
    await consultar(
      `insert into entregas.entregas
         (id_vacante, id_candidato, id_ejercicio, numero_intento, estado,
          archivo_clave, archivo_bytes, archivo_sha256, archivo_tipo, archivo_nombre)
       values ($1, $2, $3, $4, $5, $6, 1024, repeat('a', 64), 'application/zip', 'x')`,
      [idVacante, idCandidato, idEjercicio, numeroIntento, estado, `entregas/${uuid()}.zip`],
    );
  }

  beforeEach(async () => {
    await vaciarTablas();

    reclutador = await crearConRol(app, 'laura@empresa-a.com', 'reclutador', 'Empresa A');
    reclutadorDeOtraEmpresa = await crearConRol(
      app,
      'otro@empresa-b.com',
      'reclutador',
      'Empresa B',
    );
    admin = await crearConRol(app, 'admin@meritia.com', 'administrador', null);
    ana = await registrarCandidato(app, 'ana@ejemplo.com', 'Ana Maria Rojas');
    luis = await registrarCandidato(app, 'luis@ejemplo.com', 'Luis Perez');
    // El registro admite nombres que empiezan por guion: su regla permite
    // letras, espacios, apostrofos, puntos y guiones. Para una hoja de calculo,
    // una celda que empieza por guion es una formula.
    candidatoConNombrePeligroso = await registrarCandidato(app, 'raro@ejemplo.com', '-Sara Gomez');

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

  describe('CRITERIO: el reclutador consulta el ranking con desglose y evidencia', () => {
    beforeEach(async () => {
      await sembrarEvaluacion({
        idCandidato: ana.id,
        notaFinal: 55,
        creadaEn: '2026-10-01T10:00:00Z',
      });
      await sembrarEvaluacion({
        idCandidato: ana.id,
        notaFinal: 88,
        creadaEn: '2026-10-02T10:00:00Z',
      });
      await sembrarEvaluacion({
        idCandidato: luis.id,
        notaFinal: 72,
        creadaEn: '2026-10-01T11:00:00Z',
      });
    });

    it('el ranking va de mayor a menor, con una fila por candidato y su nombre', async () => {
      const { body } = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}`)
        .set(auth(reclutador))
        .expect(200);

      expect(body.vacante).toMatchObject({ titulo: 'Desarrollador backend junior' });
      expect(body.ranking).toHaveLength(2);
      expect(body.ranking[0]).toMatchObject({
        posicion: 1,
        notaFinal: 88,
        intentosEvaluados: 2,
        candidato: { nombre: 'Ana Maria Rojas', correo: 'ana@ejemplo.com' },
      });
      expect(body.ranking[1]).toMatchObject({ posicion: 2, notaFinal: 72, intentosEvaluados: 1 });
    });

    it('las cifras consolidadas cuadran con lo sembrado', async () => {
      await sembrarEntrega(ana.id, 'recibida', 9);
      await sembrarEntrega(luis.id, 'fallida', 9);

      const { body } = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}`)
        .set(auth(reclutador))
        .expect(200);

      expect(body.resumen).toMatchObject({
        candidatosEvaluados: 2,
        entregasEvaluadas: 3,
        entregasEnProceso: 1,
        entregasFallidas: 1,
        // Promedio por candidato —(88 + 72) / 2—, no por evaluacion: los tres
        // intentos darian 71,67 y Ana pesaria el doble que Luis.
        notaPromedio: 80,
        notaMaxima: 88,
        notaMinima: 72,
      });
    });

    it('el detalle del candidato trae todos sus intentos con la evidencia de cada criterio', async () => {
      const { body } = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${ana.id}`)
        .set(auth(reclutador))
        .expect(200);

      expect(body.candidato.nombre).toBe('Ana Maria Rojas');
      expect(body.posicionEnLaVacante).toBe(1);
      expect(body.intentos).toHaveLength(2);
      // Del mas reciente al mas viejo.
      expect(body.intentos.map((i: { notaFinal: number }) => i.notaFinal)).toEqual([88, 55]);
      expect(body.intentos[0].criterios[0]).toMatchObject({
        criterio: 'Correccion funcional',
        puntaje: 4,
        escalaMaxima: 5,
      });
      expect(body.intentos[0].criterios[0].evidencia).toContain('main.py');
    });

    it('un administrador de plataforma tambien lo consulta', async () => {
      await api(app).get(`/api/v1/reportes/vacantes/${idVacante}`).set(auth(admin)).expect(200);
    });

    it('una vacante sin evaluaciones responde un reporte vacio, no un error', async () => {
      const { body: otra } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Vacante recien abierta', descripcion: 'Sin nadie evaluado todavia.' })
        .expect(201);

      const { body } = await api(app)
        .get(`/api/v1/reportes/vacantes/${otra.id}`)
        .set(auth(reclutador))
        .expect(200);

      expect(body.ranking).toEqual([]);
      // Nulo y no cero: no es que la gente saque cero, es que no hay notas.
      expect(body.resumen.notaPromedio).toBeNull();
      expect(body.resumen.notaMediana).toBeNull();
    });
  });

  describe('CRITERIO: ningun reporte muestra datos de otra empresa', () => {
    beforeEach(async () => {
      await sembrarEvaluacion({
        idCandidato: ana.id,
        notaFinal: 88,
        creadaEn: '2026-10-02T10:00:00Z',
      });
    });

    it('el reclutador de otra empresa recibe 404, no 403', async () => {
      // 403 confirmaria que la vacante existe. El 404 no dice nada.
      await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}`)
        .set(auth(reclutadorDeOtraEmpresa))
        .expect(404);
    });

    it('tampoco por el detalle del candidato ni por la exportacion', async () => {
      await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${ana.id}`)
        .set(auth(reclutadorDeOtraEmpresa))
        .expect(404);
      await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/exportar`)
        .set(auth(reclutadorDeOtraEmpresa))
        .expect(404);
    });

    it('un candidato no entra a los reportes: es un permiso de rol', async () => {
      await api(app).get(`/api/v1/reportes/vacantes/${idVacante}`).set(auth(ana)).expect(403);
    });

    it('sin token no se entra', async () => {
      await api(app).get(`/api/v1/reportes/vacantes/${idVacante}`).expect(401);
    });

    it('preguntar por un candidato que no entrego en la vacante responde 404', async () => {
      // Si respondiera un reporte vacio, el reclutador podria comprobar si un
      // identificador cualquiera es de un candidato que existe.
      await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${luis.id}`)
        .set(auth(reclutador))
        .expect(404);
    });
  });

  describe('exportacion basica del reporte', () => {
    it('descarga un CSV con cabecera y una fila por candidato', async () => {
      await sembrarEvaluacion({
        idCandidato: ana.id,
        notaFinal: 88,
        creadaEn: '2026-10-02T10:00:00Z',
      });

      const respuesta = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/exportar`)
        .set(auth(reclutador))
        .expect(200);

      expect(respuesta.headers['content-type']).toContain('text/csv');
      expect(respuesta.headers['content-disposition']).toContain(
        'attachment; filename="reporte-desarrollador-backend-junior.csv"',
      );

      const texto = respuesta.text ?? String(respuesta.body);
      // El BOM va primero: sin el, Excel en Windows destroza los acentos.
      expect(texto.startsWith('﻿')).toBe(true);
      expect(texto).toContain('Posicion,Candidato,Correo,Nota final');
      expect(texto).toContain('Ana Maria Rojas');
      expect(texto).toContain('88');
    });

    it('SEGURIDAD: un nombre que empieza por guion sale neutralizado', async () => {
      await sembrarEvaluacion({
        idCandidato: candidatoConNombrePeligroso.id,
        notaFinal: 90,
        creadaEn: '2026-10-02T10:00:00Z',
      });

      const respuesta = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/exportar`)
        .set(auth(reclutador))
        .expect(200);

      const texto = respuesta.text ?? String(respuesta.body);
      // Con el apostrofo delante, la hoja de calculo lo trata como texto.
      expect(texto).toContain("'-Sara Gomez");
      expect(texto).not.toMatch(/,-Sara Gomez/);
    });
  });
});
