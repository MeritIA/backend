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

/** Criterios de aceptacion del paquete 2.3, automatizados. */
describe('integracion: banco de ejercicios', () => {
  let app: INestApplication<Server>;
  let reclutador: Sesion;
  let otroReclutador: Sesion;
  let candidato: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  const rubricaValida = [
    {
      nombre: 'Correccion funcional',
      descripcion: 'La solucion resuelve todos los casos del enunciado, incluidos los limite.',
      peso: 60,
      escalaMaxima: 5,
    },
    {
      nombre: 'Claridad del codigo',
      descripcion: 'Los nombres y la estructura permiten seguir la solucion sin esfuerzo.',
      peso: 40,
      escalaMaxima: 3,
    },
  ];

  const ejercicioValido = {
    titulo: 'Concurrencia: contador seguro entre hilos',
    tecnologia: 'Java',
    enunciado:
      'Implementa un contador que varios hilos puedan incrementar sin perder incrementos. Explica tu eleccion.',
    criterios: rubricaValida,
  };

  async function crearEjercicio(dueno = reclutador): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/ejercicios')
      .set(auth(dueno))
      .send(ejercicioValido)
      .expect(201);
    return body.id as string;
  }

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
    reclutador = await crearConRol(app, 'recl1@ejemplo.com', 'reclutador');
    // En OTRA empresa: el banco es de la empresa, y dos reclutadores de la
    // misma lo comparten. Lo que no puede cruzarse es la frontera entre
    // empresas, que es lo que comprueban las pruebas de acceso de abajo.
    otroReclutador = await crearConRol(app, 'recl2@ejemplo.com', 'reclutador', 'Empresa rival');
    candidato = await registrarCandidato(app, 'cand1@ejemplo.com');
  });

  describe('CRITERIO: la suma de los pesos se valida antes de guardar', () => {
    it('acepta una rubrica cuyos pesos suman 100', async () => {
      const { body } = await api(app)
        .post('/api/v1/ejercicios')
        .set(auth(reclutador))
        .send(ejercicioValido)
        .expect(201);

      expect(body.versiones).toHaveLength(1);
      expect(body.versiones[0].criterios).toHaveLength(2);
    });

    it('rechaza pesos que no suman 100 y NO guarda nada', async () => {
      const { body } = await api(app)
        .post('/api/v1/ejercicios')
        .set(auth(reclutador))
        .send({
          ...ejercicioValido,
          criterios: [
            { ...rubricaValida[0], peso: 60 },
            { ...rubricaValida[1], peso: 30 },
          ],
        })
        .expect(400);

      expect(body.mensaje).toMatch(/suman 90.*100/s);
      // Lo importante: la validacion ocurre ANTES de escribir.
      expect(await consultar('select 1 from ejercicios.ejercicios')).toHaveLength(0);
      expect(await consultar('select 1 from ejercicios.ejercicio_versiones')).toHaveLength(0);
    });

    it('rechaza una rubrica sin criterios', async () => {
      await api(app)
        .post('/api/v1/ejercicios')
        .set(auth(reclutador))
        .send({ ...ejercicioValido, criterios: [] })
        .expect(400);
    });

    it('rechaza dos criterios con el mismo nombre', async () => {
      await api(app)
        .post('/api/v1/ejercicios')
        .set(auth(reclutador))
        .send({
          ...ejercicioValido,
          criterios: [
            { ...rubricaValida[0], nombre: 'Claridad', peso: 50 },
            { ...rubricaValida[1], nombre: 'claridad', peso: 50 },
          ],
        })
        .expect(400);
    });

    it('rechaza una descripcion de criterio demasiado vaga', async () => {
      // El motor de IA la usa como referencia de calificacion.
      await api(app)
        .post('/api/v1/ejercicios')
        .set(auth(reclutador))
        .send({
          ...ejercicioValido,
          criterios: [{ ...rubricaValida[0], descripcion: 'bien', peso: 100 }],
        })
        .expect(400);
    });

    it('los pesos se releen como numeros, no como cadenas', async () => {
      // `numeric` llega del driver como cadena. Sin conversion, sumar pesos
      // seria concatenar textos y la validacion pasaria sin enterarse.
      const id = await crearEjercicio();
      const { body } = await api(app)
        .get(`/api/v1/ejercicios/${id}`)
        .set(auth(reclutador))
        .expect(200);

      const pesos = body.versiones[0].criterios.map((c: { peso: unknown }) => c.peso);
      for (const p of pesos) expect(typeof p).toBe('number');
      expect(pesos.reduce((a: number, b: number) => a + b, 0)).toBe(100);
    });
  });

  describe('CRITERIO: versionar sin afectar lo ya calificado', () => {
    it('crea la version 2 y conserva intacta la 1', async () => {
      const id = await crearEjercicio();

      const { body: antes } = await api(app)
        .get(`/api/v1/ejercicios/${id}`)
        .set(auth(reclutador))
        .expect(200);
      const enunciadoOriginal = antes.versiones[0].enunciado;
      const idVersion1 = antes.versiones[0].id;

      await api(app)
        .post(`/api/v1/ejercicios/${id}/versiones`)
        .set(auth(reclutador))
        .send({
          enunciado:
            'Enunciado corregido: se aclara el caso limite de la lista vacia por completo.',
          criterios: rubricaValida,
          motivoDelCambio: 'El caso limite confundia a los candidatos.',
        })
        .expect(201);

      const { body: despues } = await api(app)
        .get(`/api/v1/ejercicios/${id}`)
        .set(auth(reclutador))
        .expect(200);

      expect(despues.versiones).toHaveLength(2);
      // Llegan de la mas reciente a la mas antigua.
      expect(despues.versiones[0].numero).toBe(2);
      expect(despues.versiones[1].numero).toBe(1);

      // La version 1 sigue siendo exactamente la misma: mismo identificador y
      // mismo texto. Una calificacion emitida contra ella sigue justificada.
      const version1 = despues.versiones.find((v: { numero: number }) => v.numero === 1);
      expect(version1.id).toBe(idVersion1);
      expect(version1.enunciado).toBe(enunciadoOriginal);
    });

    it('cada version conserva SU rubrica, no la de la ultima', async () => {
      const id = await crearEjercicio();

      await api(app)
        .post(`/api/v1/ejercicios/${id}/versiones`)
        .set(auth(reclutador))
        .send({
          enunciado: 'Enunciado de la segunda version, con su propia ponderacion distinta.',
          criterios: [
            { ...rubricaValida[0], peso: 20 },
            { ...rubricaValida[1], peso: 80 },
          ],
        })
        .expect(201);

      const { body } = await api(app)
        .get(`/api/v1/ejercicios/${id}`)
        .set(auth(reclutador))
        .expect(200);

      const pesoDe = (numero: number, nombre: string) =>
        body.versiones
          .find((v: { numero: number }) => v.numero === numero)
          .criterios.find((c: { nombre: string }) => c.nombre === nombre).peso;

      expect(pesoDe(1, 'Correccion funcional')).toBe(60);
      expect(pesoDe(2, 'Correccion funcional')).toBe(20);
    });

    it('NO existe forma de editar una version ya creada', async () => {
      const id = await crearEjercicio();
      const { body } = await api(app)
        .get(`/api/v1/ejercicios/${id}`)
        .set(auth(reclutador))
        .expect(200);
      const idVersion = body.versiones[0].id;

      // No hay endpoint de edicion de versiones, a proposito: corregir es
      // versionar. Se comprueba que ninguna via lo permita.
      for (const ruta of [
        `/api/v1/ejercicios/${id}/versiones/${idVersion}`,
        `/api/v1/ejercicios/versiones/${idVersion}`,
      ]) {
        const r = await api(app).patch(ruta).set(auth(reclutador)).send({ enunciado: 'Alterado' });
        expect(r.status).toBe(404);
      }
    });

    it('la nueva version no hereda criterios sin revisar', async () => {
      const id = await crearEjercicio();
      // El enunciado y la rubrica van completos: una version es una unidad
      // cerrada. Sin criterios, se rechaza.
      await api(app)
        .post(`/api/v1/ejercicios/${id}/versiones`)
        .set(auth(reclutador))
        .send({ enunciado: 'Enunciado nuevo suficientemente largo para pasar la validacion.' })
        .expect(400);
    });

    it('los numeros de version son correlativos', async () => {
      const id = await crearEjercicio();
      for (let i = 0; i < 3; i++) {
        await api(app)
          .post(`/api/v1/ejercicios/${id}/versiones`)
          .set(auth(reclutador))
          .send({
            enunciado: `Enunciado de la version numero ${i + 2}, suficientemente largo para validar.`,
            criterios: rubricaValida,
          })
          .expect(201);
      }

      const filas = await consultar<{ numero: number }>(
        'select numero from ejercicios.ejercicio_versiones where id_ejercicio = $1 order by numero',
        [id],
      );
      expect(filas.map((f) => f.numero)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('retirada del banco', () => {
    it('retirar conserva el ejercicio y sus versiones', async () => {
      const id = await crearEjercicio();
      await api(app).delete(`/api/v1/ejercicios/${id}`).set(auth(reclutador)).expect(200);

      const [fila] = await consultar<{ activo: boolean }>(
        'select activo from ejercicios.ejercicios where id = $1',
        [id],
      );
      expect(fila.activo).toBe(false);
      // Lo ya calificado tiene que seguir siendo auditable.
      expect(
        await consultar('select 1 from ejercicios.ejercicio_versiones where id_ejercicio = $1', [
          id,
        ]),
      ).toHaveLength(1);
    });
  });

  describe('acceso por recurso', () => {
    it('un reclutador de otra empresa no ve ni versiona un ejercicio ajeno', async () => {
      const id = await crearEjercicio();

      await api(app).get(`/api/v1/ejercicios/${id}`).set(auth(otroReclutador)).expect(404);
      await api(app)
        .post(`/api/v1/ejercicios/${id}/versiones`)
        .set(auth(otroReclutador))
        .send({
          enunciado: 'Intento de versionar un ejercicio ajeno, texto largo.',
          criterios: rubricaValida,
        })
        .expect(404);
      await api(app).delete(`/api/v1/ejercicios/${id}`).set(auth(otroReclutador)).expect(404);
    });

    it('un candidato no accede al banco', async () => {
      await crearEjercicio();
      await api(app).get('/api/v1/ejercicios').set(auth(candidato)).expect(403);
      await api(app)
        .post('/api/v1/ejercicios')
        .set(auth(candidato))
        .send(ejercicioValido)
        .expect(403);
    });

    it('el listado de un reclutador no incluye los de otra empresa', async () => {
      await crearEjercicio(reclutador);
      await crearEjercicio(otroReclutador);

      const { body } = await api(app).get('/api/v1/ejercicios').set(auth(reclutador)).expect(200);
      expect(body).toHaveLength(1);
    });
  });

  describe('la vacante valida contra el banco', () => {
    it('rechaza asociar un ejercicio que no existe', async () => {
      const { body: vacante } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Backend junior', descripcion: 'Descripcion suficientemente larga.' })
        .expect(201);

      const inventado = crypto.randomUUID();
      const { body } = await api(app)
        .put(`/api/v1/vacantes/${vacante.id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [inventado] })
        .expect(400);

      expect(body.mensaje).toContain(inventado);
    });

    it('acepta uno que si existe', async () => {
      const idEjercicio = await crearEjercicio();
      const { body: vacante } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Backend junior', descripcion: 'Descripcion suficientemente larga.' })
        .expect(201);

      await api(app)
        .put(`/api/v1/vacantes/${vacante.id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [idEjercicio] })
        .expect(200);
    });

    it('rechaza uno retirado del banco', async () => {
      const idEjercicio = await crearEjercicio();
      await api(app).delete(`/api/v1/ejercicios/${idEjercicio}`).set(auth(reclutador)).expect(200);

      const { body: vacante } = await api(app)
        .post('/api/v1/vacantes')
        .set(auth(reclutador))
        .send({ titulo: 'Backend junior', descripcion: 'Descripcion suficientemente larga.' })
        .expect(201);

      await api(app)
        .put(`/api/v1/vacantes/${vacante.id}/ejercicios`)
        .set(auth(reclutador))
        .send({ idsDeEjercicios: [idEjercicio] })
        .expect(400);
    });
  });

  describe('concurrencia', () => {
    it('dos versiones creadas a la vez no comparten numero', async () => {
      const id = await crearEjercicio();

      await Promise.all([
        api(app).post(`/api/v1/ejercicios/${id}/versiones`).set(auth(reclutador)).send({
          enunciado: 'Primera version simultanea, con texto suficientemente largo.',
          criterios: rubricaValida,
        }),
        api(app).post(`/api/v1/ejercicios/${id}/versiones`).set(auth(reclutador)).send({
          enunciado: 'Segunda version simultanea, con texto suficientemente largo.',
          criterios: rubricaValida,
        }),
      ]);

      const filas = await consultar<{ numero: number }>(
        'select numero from ejercicios.ejercicio_versiones where id_ejercicio = $1 order by numero',
        [id],
      );
      // El bloqueo del ejercicio serializa el calculo del numero; la
      // restriccion unica es la red de seguridad si el bloqueo fallara.
      expect(filas.map((f) => f.numero)).toEqual([1, 2, 3]);
    });
  });
});
