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

    it('el ranking va de mayor a menor, con una fila por candidato y SIN su nombre', async () => {
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
      });
      // El proposito del producto es reducir el sesgo: el ranking se compara
      // sin nombres. Esta es la asercion que lo sostiene.
      expect(body.ranking[0].alias).toMatch(/^Candidato ••••[0-9a-f]{6}$/);
      expect(JSON.stringify(body)).not.toContain('Ana Maria Rojas');
      expect(JSON.stringify(body)).not.toContain('ana@ejemplo.com');
      expect(body.ranking[1]).toMatchObject({ posicion: 2, notaFinal: 72, intentosEvaluados: 1 });
    });

    it('cada fila trae su habilidad destacada, del intento que puntua (A06)', async () => {
      const sara = await registrarCandidato(app, 'sara-habilidad@ejemplo.com', 'Sara Ruiz');
      await sembrarEvaluacion({
        idCandidato: sara.id,
        notaFinal: 95,
        creadaEn: '2026-10-04T10:00:00Z',
        criterios: [
          // 8 de 20 es el 40 %; 4 de 5 es el 80 %. Gana el porcentaje, no el
          // puntaje crudo.
          { criterio: 'Arquitectura', puntaje: 8, escalaMaxima: 20, peso: 60 },
          { criterio: 'Pruebas automatizadas', puntaje: 4, escalaMaxima: 5, peso: 40 },
        ],
      });

      const { body } = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}`)
        .set(auth(reclutador))
        .expect(200);

      const deSara = (body.ranking as { idCandidato: string; habilidadDestacada: unknown }[]).find(
        (f) => f.idCandidato === sara.id,
      );
      expect(deSara?.habilidadDestacada).toEqual({
        criterio: 'Pruebas automatizadas',
        porcentajeLogrado: 80,
        peso: 40,
      });

      // Y el CSV lleva la misma columna: es la tabla que el reclutador pega en
      // su hoja de seguimiento.
      const exportado = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/exportar`)
        .set(auth(reclutador))
        .expect(200);
      expect(exportado.text ?? String(exportado.body)).toContain('Habilidad destacada');
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

      expect(body.alias).toMatch(/^Candidato ••••[0-9a-f]{6}$/);
      expect(JSON.stringify(body)).not.toContain('Ana Maria Rojas');
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

  describe('CRITERIO: revelar la identidad es una accion, y deja rastro', () => {
    beforeEach(async () => {
      await sembrarEvaluacion({
        idCandidato: ana.id,
        notaFinal: 88,
        creadaEn: '2026-10-02T10:00:00Z',
      });
    });

    it('devuelve nombre y correo, y el alias para cruzarlo con el ranking', async () => {
      const { body } = await api(app)
        .post(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${ana.id}/revelar`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toMatchObject({
        idCandidato: ana.id,
        nombre: 'Ana Maria Rojas',
        correo: 'ana@ejemplo.com',
      });
      expect(body.alias).toMatch(/^Candidato ••••[0-9a-f]{6}$/);
    });

    it('el alias que devuelve es EL MISMO que muestra el ranking', async () => {
      // Si no coincidiera, el reclutador no podria saber a que fila corresponde
      // la identidad que acaba de pedir, y la pantalla seria inutil.
      const { body: reporte } = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}`)
        .set(auth(reclutador))
        .expect(200);
      const { body: revelada } = await api(app)
        .post(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${ana.id}/revelar`)
        .set(auth(reclutador))
        .expect(200);

      const fila = reporte.ranking.find((f: { idCandidato: string }) => f.idCandidato === ana.id);
      expect(revelada.alias).toBe(fila.alias);
    });

    it('queda registrado quien la revelo y cuando', async () => {
      await api(app)
        .post(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${ana.id}/revelar`)
        .set(auth(reclutador))
        .expect(200);

      const { body } = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/revelaciones`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ idCandidato: ana.id, idUsuario: reclutador.id });
      // El registro NO lleva el nombre: guardarlo ahi seria copiar el dato
      // personal a una segunda tabla para auditar que alguien lo miro.
      expect(JSON.stringify(body)).not.toContain('Ana Maria Rojas');
    });

    it('revelar dos veces deja DOS registros: es un log de accesos', async () => {
      // Una tabla de estado diria "ya la vio" y perderia cuantas veces y
      // cuando, que es justo lo que mira una auditoria.
      for (let i = 0; i < 2; i++) {
        await api(app)
          .post(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${ana.id}/revelar`)
          .set(auth(reclutador))
          .expect(200);
      }

      const { body } = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/revelaciones`)
        .set(auth(reclutador))
        .expect(200);
      expect(body).toHaveLength(2);
    });

    it('el reclutador de otra empresa no revela nada', async () => {
      await api(app)
        .post(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${ana.id}/revelar`)
        .set(auth(reclutadorDeOtraEmpresa))
        .expect(404);
      await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}/revelaciones`)
        .set(auth(reclutadorDeOtraEmpresa))
        .expect(404);
    });

    it('no se revela la identidad de quien no participa en la vacante', async () => {
      await api(app)
        .post(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${luis.id}/revelar`)
        .set(auth(reclutador))
        .expect(404);
    });

    it('un candidato no puede revelar identidades', async () => {
      await api(app)
        .post(`/api/v1/reportes/vacantes/${idVacante}/candidatos/${ana.id}/revelar`)
        .set(auth(ana))
        .expect(403);
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
      expect(texto).toContain('Posicion,Candidato,Nota final');
      expect(texto).toContain('Candidato ••••');
      expect(texto).toContain('88');
      // Un export que filtra lo que la pantalla protege no protege nada, y un
      // CSV se reenvia con mas facilidad todavia.
      expect(texto).not.toContain('Ana Maria Rojas');
      expect(texto).not.toContain('ana@ejemplo.com');
    });

    it('SEGURIDAD: el CSV sigue neutralizando formulas, ahora sobre el alias', async () => {
      // El nombre peligroso ya no llega al CSV —ahora va alias—, pero la
      // defensa sigue viva para cualquier celda: la evidencia, un titulo de
      // vacante o lo que se exporte manana. La prueba de la funcion pura
      // cubre los seis caracteres; aqui se comprueba de extremo a extremo que
      // ninguna celda empieza por uno de ellos sin apostrofo.
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
      expect(texto).not.toContain('-Sara Gomez');

      // Ninguna celda puede empezar por un caracter que una hoja de calculo
      // interprete como formula.
      const PELIGROSOS = ['=', '+', '-', '@', String.fromCharCode(9), String.fromCharCode(13)];
      const filas = texto.slice(1).trim().split(String.fromCharCode(13, 10)).slice(1);
      expect(filas.length).toBeGreaterThan(0);
      for (const fila of filas) {
        for (const celda of fila.split(',')) {
          expect(PELIGROSOS.some((p) => celda.startsWith(p))).toBe(false);
        }
      }
    });
  });

  /**
   * El puesto que ve el candidato (pantalla B22).
   *
   * La ruta vive en el modulo de evaluacion —reportes depende de evaluacion, no
   * al contrario—, pero la prueba vive aqui porque lo que importa comprobar es
   * que el numero que ve el candidato y el ranking que ve el reclutador NO se
   * pueden separar. Son dos implementaciones del mismo concepto: una agrupacion
   * en SQL y una funcion pura. Si alguien cambia una, esta prueba lo dice.
   */
  describe('CRITERIO: el candidato ve su puesto, y solo con el proceso cerrado', () => {
    const invitar = (quien: Sesion) =>
      api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: quien.id })
        .expect(200);

    const cerrar = () =>
      api(app).post(`/api/v1/vacantes/${idVacante}/cerrar`).set(auth(reclutador)).expect(200);

    const miPuesto = (quien: Sesion) =>
      api(app).get(`/api/v1/evaluaciones/vacante/${idVacante}/mi-puesto`).set(auth(quien));

    beforeEach(async () => {
      await invitar(ana);
      await invitar(luis);
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

    it('con el proceso abierto no da el puesto, y dice por que', async () => {
      // El puesto cambia cada vez que otro entrega: con la vacante abierta no
      // es informacion del candidato, es un canal lateral sobre los demas.
      const { body } = await miPuesto(ana).expect(200);

      expect(body).toMatchObject({
        disponible: false,
        motivo: 'proceso_en_curso',
        puesto: null,
        total: null,
      });
      // Ni de refilon: tampoco su propia nota por esta via, que para eso esta
      // la evaluacion de su entrega.
      expect(body.notaFinal).toBeNull();
    });

    it('con la vacante cerrada da su puesto y cuanta gente participo', async () => {
      await cerrar();

      const { body: deAna } = await miPuesto(ana).expect(200);
      expect(deAna).toMatchObject({ disponible: true, puesto: 1, total: 2, notaFinal: 88 });

      const { body: deLuis } = await miPuesto(luis).expect(200);
      expect(deLuis).toMatchObject({ disponible: true, puesto: 2, total: 2, notaFinal: 72 });
    });

    it('no filtra nada de los demas: ni alias, ni identificadores, ni notas ajenas', async () => {
      await cerrar();

      const { body } = await miPuesto(luis).expect(200);
      const comoTexto = JSON.stringify(body);

      expect(comoTexto).not.toContain(ana.id);
      expect(comoTexto).not.toContain('Ana Maria Rojas');

      // La nota de Ana (88) no puede salir por ningun campo. Buscarla en el
      // texto no sirve: un UUID puede contener "88" por casualidad, y de hecho
      // lo hizo. Se miran los valores, y se fija la forma de la respuesta para
      // que un campo nuevo no se cuele sin que nadie lo revise.
      expect(Object.values(body)).not.toContain(88);
      expect(Object.keys(body).sort()).toEqual([
        'disponible',
        'estadoVacante',
        'idVacante',
        'notaFinal',
        'puesto',
        'total',
      ]);
    });

    it('el puesto del candidato es EL MISMO que el del ranking del reclutador', async () => {
      // Con empate, que es donde dos implementaciones se separan: los dos
      // primeros comparten el puesto 1 y el siguiente salta al 3.
      await sembrarEvaluacion({
        idCandidato: luis.id,
        notaFinal: 88,
        creadaEn: '2026-10-03T10:00:00Z',
      });
      const sara = await registrarCandidato(app, 'sara-puesto@ejemplo.com', 'Sara Lopez');
      await invitar(sara);
      await sembrarEvaluacion({
        idCandidato: sara.id,
        notaFinal: 60,
        creadaEn: '2026-10-01T09:00:00Z',
      });
      await cerrar();

      const { body: reporte } = await api(app)
        .get(`/api/v1/reportes/vacantes/${idVacante}`)
        .set(auth(reclutador))
        .expect(200);

      const posicionEnElRanking = (id: string): number =>
        (reporte.ranking as { idCandidato: string; posicion: number }[]).find(
          (f) => f.idCandidato === id,
        )!.posicion;

      for (const quien of [ana, luis, sara]) {
        const { body } = await miPuesto(quien).expect(200);
        expect(body.puesto).toBe(posicionEnElRanking(quien.id));
        expect(body.total).toBe(reporte.ranking.length);
      }

      // Y el empate es de verdad un empate, no una coincidencia de la prueba.
      expect(posicionEnElRanking(ana.id)).toBe(1);
      expect(posicionEnElRanking(luis.id)).toBe(1);
      expect(posicionEnElRanking(sara.id)).toBe(3);
    });

    it('invitado pero sin ninguna entrega evaluada: no es un error, es que no participo', async () => {
      const mudo = await registrarCandidato(app, 'mudo@ejemplo.com', 'Pedro Silencio');
      await invitar(mudo);
      await cerrar();

      const { body } = await miPuesto(mudo).expect(200);
      expect(body).toMatchObject({ disponible: false, motivo: 'sin_evaluacion', puesto: null });
    });

    it('un candidato que no fue invitado recibe 404, no un puesto', async () => {
      const ajeno = await registrarCandidato(app, 'ajeno@ejemplo.com', 'Nadie Invitado');
      await cerrar();

      // 404 y no 403: con un 403 podria averiguar que vacantes existen
      // probando identificadores.
      await miPuesto(ajeno).expect(404);
      await api(app)
        .get(`/api/v1/evaluaciones/vacante/${uuid()}/mi-puesto`)
        .set(auth(ana))
        .expect(404);
    });

    it('la ruta es del candidato: el reclutador tiene el ranking, no un puesto', async () => {
      await cerrar();

      await miPuesto(reclutador).expect(403);
      await api(app)
        .get(`/api/v1/evaluaciones/vacante/${idVacante}/mi-puesto`)
        .set(auth(admin))
        .expect(403);
    });
  });

  describe('CRITERIO: el panel de la empresa en una sola llamada (A02)', () => {
    const panel = (quien: Sesion) => api(app).get('/api/v1/reportes/panel').set(auth(quien));

    it('las cifras cuadran con lo sembrado, y los retos retirados no se cuentan', async () => {
      // Una vacante mas en borrador y otra cerrada, sobre la publicada del
      // montaje.
      const { body: borrador } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Analista de datos', descripcion: 'Para el equipo de datos.' })
        .expect(201);
      expect(borrador.estado).toBe('borrador');

      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: ana.id })
        .expect(200);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos/${ana.id}/contratar`)
        .set(auth(reclutador))
        .expect(200);

      await sembrarEntrega(ana.id, 'recibida', 1);
      await sembrarEntrega(luis.id, 'en_evaluacion', 1);
      await sembrarEntrega(luis.id, 'evaluada', 2);
      await sembrarEntrega(ana.id, 'fallida', 3);

      const retirado = await crearEjercicioEnElBanco(app, reclutador, `Retirado ${uuid()}`);
      await api(app).delete(`/api/v1/ejercicios/${retirado}`).set(auth(reclutador)).expect(200);

      const { body } = await panel(reclutador).expect(200);

      expect(body.vacantes).toEqual({ borradores: 1, publicadas: 1, cerradas: 0 });
      expect(body).toMatchObject({
        entregasPorEvaluar: 2,
        entregasEvaluadas: 1,
        entregasFallidas: 1,
        contratados: 1,
        // El del montaje. El retirado se conserva para que las evaluaciones
        // emitidas sigan siendo auditables, pero ya no es material disponible.
        retosEnElBanco: 1,
      });
    });

    it('cuenta PERSONAS en finalistas y ENTREGAS en la cola: la diferencia son los reintentos', async () => {
      await sembrarEntrega(ana.id, 'recibida', 1);
      await sembrarEntrega(ana.id, 'en_evaluacion', 2);

      const { body } = await panel(reclutador).expect(200);

      // Una sola persona esperando, con dos entregas. Si el panel contara
      // entregas, diria que hay dos finalistas donde hay una.
      expect(body.finalistasEnEvaluacion).toBe(1);
      expect(body.entregasPorEvaluar).toBe(2);
    });

    it('no mezcla empresas: la vecina ve su propio panel en ceros', async () => {
      await sembrarEntrega(ana.id, 'recibida', 1);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: ana.id })
        .expect(200);
      await api(app)
        .post(`/api/v1/vacantes/${idVacante}/candidatos/${ana.id}/contratar`)
        .set(auth(reclutador))
        .expect(200);

      const { body } = await panel(reclutadorDeOtraEmpresa).expect(200);

      expect(body.vacantes).toEqual({ borradores: 0, publicadas: 0, cerradas: 0 });
      expect(body).toMatchObject({
        finalistasEnEvaluacion: 0,
        entregasPorEvaluar: 0,
        contratados: 0,
        retosEnElBanco: 0,
      });
    });

    it('un administrador de plataforma no tiene panel: no pertenece a ninguna empresa', async () => {
      // Devolver ceros seria peor: pareceria una empresa sin actividad.
      const { body } = await panel(admin).expect(400);
      expect(body.mensaje).toMatch(/empresa/i);
    });

    it('un candidato no ve el panel de la empresa', async () => {
      await panel(ana).expect(403);
    });
  });

  /**
   * El plan de la vacante (A02 y A04) y el avance que el panel calcula con el.
   *
   * Se prueba por HTTP y no contra el servicio porque lo que importa es que la
   * pantalla pueda pintar sus tarjetas con una sola llamada: si el avance
   * saliera de una consulta por vacante, estas pruebas pasarian igual y el
   * panel seria inservible con veinte vacantes abiertas.
   */
  describe('CRITERIO: cierre estimado, finalistas a evaluar y el avance (A02, A04)', () => {
    const panel = (quien: Sesion) => api(app).get('/api/v1/reportes/panel').set(auth(quien));

    /** Crea una vacante, le asocia el ejercicio del montaje y la publica. */
    async function publicarVacante(
      titulo: string,
      extra: Record<string, unknown> = {},
    ): Promise<string> {
      const { body } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo, descripcion: 'Buscamos una persona para el equipo.', ...extra })
        .expect(201);
      const id = body.id as string;

      await api(app)
        .put(`/api/v1/vacantes/${id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [idEjercicio] })
        .expect(200);
      await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(reclutador)).expect(200);
      return id;
    }

    const invitar = (id: string, candidato: Sesion) =>
      api(app)
        .post(`/api/v1/vacantes/${id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);

    async function entregaEn(id: string, candidato: Sesion, intento: number): Promise<void> {
      await consultar(
        `insert into entregas.entregas
           (id_vacante, id_candidato, id_ejercicio, numero_intento, estado,
            archivo_clave, archivo_bytes, archivo_sha256, archivo_tipo, archivo_nombre)
         values ($1, $2, $3, $4, 'evaluada', $5, 1024, repeat('a', 64), 'application/zip', 'x')`,
        [id, candidato.id, idEjercicio, intento, `entregas/${uuid()}.zip`],
      );
    }

    describe('los dos campos del plan', () => {
      it('se guardan al crear y se leen de vuelta', async () => {
        const { body } = await api(app)
          .post('/api/v1/vacantes')
          .set(auth(reclutador))
          .send({
            titulo: 'Analista de datos',
            descripcion: 'Para el equipo de datos y reportes.',
            cierreEstimado: '2026-12-15T23:59:59.000Z',
            finalistasAEvaluar: 8,
          })
          .expect(201);

        expect(body.cierreEstimado).toBe('2026-12-15T23:59:59.000Z');
        expect(body.finalistasAEvaluar).toBe(8);
      });

      it('sin enviarlos quedan en null: nadie planifico nada', async () => {
        const { body } = await api(app)
          .post('/api/v1/vacantes')
          .set(auth(reclutador))
          .send({ titulo: 'Sin plan', descripcion: 'Una vacante recien creada, sin plan.' })
          .expect(201);

        // Null y no cero ni una fecha inventada: el panel tiene que poder
        // distinguir "no planificado" de "planificado en cero".
        expect(body.cierreEstimado).toBeNull();
        expect(body.finalistasAEvaluar).toBeNull();
      });

      it('rechaza un estimado que no es una fecha y un plan de cero o negativo', async () => {
        const malas = [
          { cierreEstimado: 'el mes que viene' },
          { cierreEstimado: '2026-13-45' },
          { finalistasAEvaluar: 0 },
          { finalistasAEvaluar: -3 },
          { finalistasAEvaluar: 2.5 },
          { finalistasAEvaluar: 100_000 },
        ];

        for (const mala of malas) {
          await api(app)
            .post('/api/v1/vacantes')
            .set(auth(reclutador))
            .send({
              titulo: 'Con dato malo',
              descripcion: 'Descripcion suficientemente larga.',
              ...mala,
            })
            .expect(400);
        }
      });

      it('ACEPTA un estimado en el pasado, a proposito', async () => {
        const { body } = await api(app)
          .post('/api/v1/vacantes')
          .set(auth(reclutador))
          .send({
            titulo: 'Vacante vencida',
            descripcion: 'Un proceso que se paso de su estimado.',
            cierreEstimado: '2020-01-01T00:00:00.000Z',
          })
          .expect(201);

        // Rechazarlo esconderia que el proceso esta vencido, que es justo lo
        // que el panel tiene que mostrar. Y un frontend que reenvia el objeto
        // completo al editar el titulo no debe fallar por un estimado viejo.
        expect(body.cierreEstimado).toBe('2020-01-01T00:00:00.000Z');
      });

      it('null borra el estimado', async () => {
        const { body: creada } = await api(app)
          .post('/api/v1/vacantes')
          .set(auth(reclutador))
          .send({
            titulo: 'Con estimado',
            descripcion: 'Una vacante con fecha estimada de cierre.',
            cierreEstimado: '2026-12-01T00:00:00.000Z',
          })
          .expect(201);

        const { body } = await api(app)
          .patch(`/api/v1/vacantes/${creada.id}`)
          .set(auth(reclutador))
          .send({ cierreEstimado: null })
          .expect(200);

        expect(body.cierreEstimado).toBeNull();
      });

      it('el plan se cambia con la vacante publicada, los intentos no', async () => {
        const { body } = await api(app)
          .patch(`/api/v1/vacantes/${idVacante}`)
          .set(auth(reclutador))
          .send({ finalistasAEvaluar: 12 })
          .expect(200);
        expect(body.finalistasAEvaluar).toBe(12);

        // La diferencia no es capricho: subir el plan no le quita nada a nadie,
        // y cambiar los intentos a mitad del proceso le da a unos candidatos
        // mas oportunidades que a otros.
        const { body: error } = await api(app)
          .patch(`/api/v1/vacantes/${idVacante}`)
          .set(auth(reclutador))
          .send({ intentosPermitidos: 5 })
          .expect(400);
        expect(error.mensaje).toMatch(/borrador/i);
      });

      it('un reclutador de otra empresa no puede ponerle plan a esta vacante', async () => {
        await api(app)
          .patch(`/api/v1/vacantes/${idVacante}`)
          .set(auth(reclutadorDeOtraEmpresa))
          .send({ finalistasAEvaluar: 4 })
          .expect(404);
      });
    });

    describe('el avance en el panel', () => {
      it('es el porcentaje de invitados ya evaluados, con las cifras crudas al lado', async () => {
        await invitar(idVacante, ana);
        await invitar(idVacante, luis);
        await invitar(idVacante, candidatoConNombrePeligroso);

        // Ana entrego dos veces y tiene evaluacion; Luis entrego y no se ha
        // evaluado; la tercera persona no ha hecho nada.
        await entregaEn(idVacante, ana, 1);
        await entregaEn(idVacante, ana, 2);
        await entregaEn(idVacante, luis, 1);
        await sembrarEvaluacion({
          idCandidato: ana.id,
          notaFinal: 70,
          creadaEn: '2026-10-05T10:00:00Z',
        });

        const { body } = await panel(reclutador).expect(200);

        expect(body.abiertas).toHaveLength(1);
        expect(body.abiertas[0]).toMatchObject({
          id: idVacante,
          titulo: 'Desarrollador backend junior',
          invitados: 3,
          // PERSONAS, no entregas: Ana entrego dos veces y cuenta una.
          conEntrega: 2,
          evaluados: 1,
          avance: 33,
        });
      });

      it('dos evaluaciones de la misma persona no la cuentan dos veces', async () => {
        await invitar(idVacante, ana);
        await invitar(idVacante, luis);

        for (const creadaEn of ['2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z']) {
          await sembrarEvaluacion({ idCandidato: ana.id, notaFinal: 60, creadaEn });
        }

        const { body } = await panel(reclutador).expect(200);

        // Si contara evaluaciones diria 100 % con la mitad de la gente sin evaluar.
        expect(body.abiertas[0]).toMatchObject({ invitados: 2, evaluados: 1, avance: 50 });
      });

      it('sin nadie invitado el avance es null, y con invitados sin evaluar es 0', async () => {
        const { body: recien } = await panel(reclutador).expect(200);
        expect(recien.abiertas[0].invitados).toBe(0);
        // Null dice "no ha empezado"; un 0 % diria "esta parado".
        expect(recien.abiertas[0].avance).toBeNull();

        await invitar(idVacante, ana);
        const { body } = await panel(reclutador).expect(200);
        expect(body.abiertas[0].avance).toBe(0);
      });

      it('los borradores y las cerradas no salen en la lista, solo en los contadores', async () => {
        await api(app)
          .post('/api/v1/vacantes')
          .set(auth(reclutador))
          .send({ titulo: 'Un borrador', descripcion: 'Todavia no se publica esta vacante.' })
          .expect(201);
        const cerrada = await publicarVacante('Para cerrar');
        await api(app).post(`/api/v1/vacantes/${cerrada}/cerrar`).set(auth(reclutador)).expect(200);

        const { body } = await panel(reclutador).expect(200);

        expect(body.vacantes).toEqual({ borradores: 1, publicadas: 1, cerradas: 1 });
        expect(body.abiertas.map((v: { id: string }) => v.id)).toEqual([idVacante]);
      });

      it('ordena por cierre estimado, y las que no tienen estimado al final', async () => {
        const diciembre = await publicarVacante('Cierra en diciembre', {
          cierreEstimado: '2026-12-20T00:00:00.000Z',
        });
        const noviembre = await publicarVacante('Cierra en noviembre', {
          cierreEstimado: '2026-11-05T00:00:00.000Z',
        });

        const { body } = await panel(reclutador).expect(200);

        // Lo que se vence antes, primero. La del montaje no tiene estimado.
        expect(body.abiertas.map((v: { id: string }) => v.id)).toEqual([
          noviembre,
          diciembre,
          idVacante,
        ]);
      });

      it('el plan viaja con cada tarjeta y los evaluados pueden superarlo', async () => {
        await api(app)
          .patch(`/api/v1/vacantes/${idVacante}`)
          .set(auth(reclutador))
          .send({ finalistasAEvaluar: 1 })
          .expect(200);
        await invitar(idVacante, ana);
        await invitar(idVacante, luis);
        for (const quien of [ana, luis]) {
          await sembrarEvaluacion({
            idCandidato: quien.id,
            notaFinal: 65,
            creadaEn: '2026-10-05T10:00:00Z',
          });
        }

        const { body } = await panel(reclutador).expect(200);

        // Es un plan, no un tope: la pantalla puede decir "2 evaluados de 1
        // planeado" y el avance no se recorta por eso.
        expect(body.abiertas[0]).toMatchObject({
          finalistasAEvaluar: 1,
          evaluados: 2,
          avance: 100,
        });
      });

      it('la empresa vecina no ve estas vacantes en su panel', async () => {
        await invitar(idVacante, ana);
        await sembrarEvaluacion({
          idCandidato: ana.id,
          notaFinal: 90,
          creadaEn: '2026-10-05T10:00:00Z',
        });

        const { body } = await panel(reclutadorDeOtraEmpresa).expect(200);

        expect(body.abiertas).toEqual([]);
      });

      it('el avance de una vacante no cuenta las evaluaciones de otra', async () => {
        const otra = await publicarVacante('Otra vacante de la misma empresa');
        await invitar(idVacante, ana);
        await invitar(otra, ana);
        await invitar(otra, luis);

        // Solo evaluada en la segunda.
        await sembrarEvaluacion({
          idCandidato: ana.id,
          notaFinal: 80,
          creadaEn: '2026-10-05T10:00:00Z',
          idVacanteDistinta: otra,
        });

        const { body } = await panel(reclutador).expect(200);
        const porId = new Map(
          (body.abiertas as { id: string; avance: number | null }[]).map((v) => [v.id, v.avance]),
        );

        expect(porId.get(idVacante)).toBe(0);
        expect(porId.get(otra)).toBe(50);
      });
    });
  });
});
