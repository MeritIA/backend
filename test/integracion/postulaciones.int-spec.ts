import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * Postulaciones y catalogo abierto.
 *
 * Cierra la mitad de la contradiccion §6.2 que se puede cerrar sin inventar un
 * motor de afinidad: el candidato encuentra la oferta y pide entrar. Ver
 * ADR-0015.
 *
 * Lo que mas se prueba aqui no es el camino feliz: es que cambiar un
 * identificador en la peticion no de acceso a nada, que es el criterio del
 * encuadre.
 */
describe('integracion: postulaciones', () => {
  let app: INestApplication<Server>;
  let reclutador: Sesion;
  let otroReclutador: Sesion;
  let candidato: Sesion;
  let otroCandidato: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });

  let contador = 0;

  /** Una vacante publicada y lista para recibir postulaciones. */
  async function vacantePublicada(dueno = reclutador): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(dueno))
      .send({
        titulo: `Desarrollador backend ${++contador}`,
        descripcion: 'Buscamos una persona para el equipo de plataforma de MeritIA.',
      })
      .expect(201);
    const id = body.id as string;

    const idEjercicio = await crearEjercicioEnElBanco(app, dueno, `Ejercicio ${contador}`);
    await api(app)
      .put(`/api/v1/vacantes/${id}/ejercicios`)
      .set(auth(dueno))
      .send({ idsDeEjercicios: [idEjercicio] })
      .expect(200);
    await api(app).post(`/api/v1/vacantes/${id}/publicar`).set(auth(dueno)).expect(200);
    return id;
  }

  async function borrador(dueno = reclutador): Promise<string> {
    const { body } = await api(app)
      .post('/api/v1/vacantes')
      .set(auth(dueno))
      .send({
        titulo: `Sin publicar ${++contador}`,
        descripcion: 'Todavia se esta redactando y nadie deberia verla.',
      })
      .expect(201);
    return body.id as string;
  }

  const MOTIVO = 'Buscamos experiencia en conciliacion de pagos y tu perfil apunta a datos.';

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
    // En otra empresa: la frontera de los datos es la empresa, no la persona.
    otroReclutador = await crearConRol(app, 'recl2@ejemplo.com', 'reclutador', 'Otra empresa');
    candidato = await registrarCandidato(app, 'cand1@ejemplo.com');
    otroCandidato = await registrarCandidato(app, 'cand2@ejemplo.com');
  }, 60_000);

  describe('el catalogo abierto', () => {
    it('un candidato ve las vacantes publicadas sin que nadie lo invite', async () => {
      const id = await vacantePublicada();

      const { body } = await api(app)
        .get('/api/v1/vacantes/abiertas')
        .set(auth(candidato))
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id, empresa: 'Empresa de pruebas' });
      // Lo que hace falta para decidir si te postulas, y nada mas.
      expect(body[0].sector).toBeDefined();
      expect(body[0]).not.toHaveProperty('nit');
    });

    it('la ruta no la devora /vacantes/:id', async () => {
      // Si `@Get(':id')` se declarara antes, esto seria un 400 de UUID invalido.
      await api(app).get('/api/v1/vacantes/abiertas').set(auth(candidato)).expect(200);
    });

    it('un borrador no aparece: todavia no esta listo para que nadie lo vea', async () => {
      await borrador();
      const { body } = await api(app)
        .get('/api/v1/vacantes/abiertas')
        .set(auth(candidato))
        .expect(200);
      expect(body).toHaveLength(0);
    });

    it('una vacante cerrada no aparece: ya no admite a nadie', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/cerrar`).set(auth(reclutador)).expect(200);

      const { body } = await api(app)
        .get('/api/v1/vacantes/abiertas')
        .set(auth(candidato))
        .expect(200);
      expect(body).toHaveLength(0);
    });

    it('las de una empresa inactiva no aparecen: seria mandar gente a un proceso parado', async () => {
      await vacantePublicada();
      await consultar(`update autenticacion.empresas set activa = false where nombre = $1`, [
        'Empresa de pruebas',
      ]);

      const { body } = await api(app)
        .get('/api/v1/vacantes/abiertas')
        .set(auth(candidato))
        .expect(200);
      expect(body).toHaveLength(0);
    });

    it('dice si ya te postulaste, para que la pantalla no ofrezca postularse dos veces', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);

      const { body } = await api(app)
        .get('/api/v1/vacantes/abiertas')
        .set(auth(candidato))
        .expect(200);
      expect(body[0].miPostulacion).toBe('en_revision');

      // Y para OTRO candidato la misma oferta sigue sin postulacion.
      const { body: deOtro } = await api(app)
        .get('/api/v1/vacantes/abiertas')
        .set(auth(otroCandidato))
        .expect(200);
      expect(deOtro[0].miPostulacion).toBeNull();
    });

    it('dice si ya estas invitado', async () => {
      const id = await vacantePublicada();
      await api(app)
        .post(`/api/v1/vacantes/${id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);

      const { body } = await api(app)
        .get('/api/v1/vacantes/abiertas')
        .set(auth(candidato))
        .expect(200);
      expect(body[0].yaInvitado).toBe(true);
    });

    it('un reclutador no entra al catalogo: no se postula, invita', async () => {
      await api(app).get('/api/v1/vacantes/abiertas').set(auth(reclutador)).expect(403);
    });
  });

  describe('postularse', () => {
    it('crea una solicitud en revision, y NO da acceso al reto', async () => {
      const id = await vacantePublicada();

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${id}/postular`)
        .set(auth(candidato))
        .expect(201);
      expect(body.estado).toBe('en_revision');

      // La prueba que de verdad importa: postularse no invita.
      const invitaciones = await consultar(
        `select 1 from vacantes.vacante_candidatos where id_vacante = $1 and id_candidato = $2`,
        [id, candidato.id],
      );
      expect(invitaciones).toHaveLength(0);

      // Y sin invitacion la vacante sigue sin existir para el.
      await api(app).get(`/api/v1/vacantes/${id}`).set(auth(candidato)).expect(404);
    });

    it('postularse dos veces no deja dos filas', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(409);

      const filas = await consultar(
        `select 1 from vacantes.postulaciones where id_vacante = $1 and id_candidato = $2`,
        [id, candidato.id],
      );
      expect(filas).toHaveLength(1);
    });

    it('a un borrador responde 404 y no "esta en borrador"', async () => {
      // Decir el estado confirmaria que existe, y con eso se sondea lo que
      // prepara una empresa probando identificadores.
      const id = await borrador();
      const { body } = await api(app)
        .post(`/api/v1/vacantes/${id}/postular`)
        .set(auth(candidato))
        .expect(404);
      expect(JSON.stringify(body)).not.toMatch(/borrador/i);
    });

    it('a una vacante que no existe, el mismo 404', async () => {
      await api(app).post(`/api/v1/vacantes/${uuid()}/postular`).set(auth(candidato)).expect(404);
    });

    it('si ya estas invitado te lo dice, en vez de dejar una solicitud que nadie resolvera', async () => {
      const id = await vacantePublicada();
      await api(app)
        .post(`/api/v1/vacantes/${id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${id}/postular`)
        .set(auth(candidato))
        .expect(400);
      expect(body.mensaje).toMatch(/ya estas invitado/i);
    });

    it('un reclutador no se postula', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(reclutador)).expect(403);
    });
  });

  describe('mis postulaciones', () => {
    it('devuelve solo las propias, salga de donde salga el identificador', async () => {
      const mia = await vacantePublicada();
      const ajena = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${mia}/postular`).set(auth(candidato)).expect(201);
      await api(app)
        .post(`/api/v1/vacantes/${ajena}/postular`)
        .set(auth(otroCandidato))
        .expect(201);

      const { body } = await api(app)
        .get('/api/v1/postulaciones/mias')
        .set(auth(candidato))
        .expect(200);
      expect(body).toHaveLength(1);
      expect(body[0].idVacante).toBe(mia);
    });

    it('un rechazo le llega con su motivo: es lo que tiene derecho a leer', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);
      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/rechazar`)
        .set(auth(reclutador))
        .send({ motivo: MOTIVO })
        .expect(200);

      const { body } = await api(app)
        .get('/api/v1/postulaciones/mias')
        .set(auth(candidato))
        .expect(200);
      expect(body[0]).toMatchObject({ estado: 'rechazada', motivoDelRechazo: MOTIVO });
    });
  });

  describe('los postulantes que ve la empresa', () => {
    it('no traen nombre ni correo, igual que el ranking', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);

      const { body } = await api(app)
        .get(`/api/v1/vacantes/${id}/postulaciones`)
        .set(auth(reclutador))
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].idCandidato).toBe(candidato.id);
      const serializado = JSON.stringify(body);
      expect(serializado).not.toContain(candidato.correo);
      expect(serializado).not.toMatch(/nombreCompleto/);
    });

    it('un reclutador de otra empresa recibe 404, no 403', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);

      await api(app)
        .get(`/api/v1/vacantes/${id}/postulaciones`)
        .set(auth(otroReclutador))
        .expect(404);
    });

    it('un candidato no ve la lista de postulantes', async () => {
      const id = await vacantePublicada();
      await api(app).get(`/api/v1/vacantes/${id}/postulaciones`).set(auth(candidato)).expect(403);
    });
  });

  describe('aceptar', () => {
    it('invita de verdad: el candidato pasa a ver la vacante y puede entregar', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/aceptar`)
        .set(auth(reclutador))
        .expect(200);
      expect(body.estado).toBe('aceptada');
      expect(body.idUsuarioQueDecidio).toBe(reclutador.id);

      // La invitacion existe en la tabla que controla el acceso, no en otra.
      const invitaciones = await consultar(
        `select 1 from vacantes.vacante_candidatos where id_vacante = $1 and id_candidato = $2`,
        [id, candidato.id],
      );
      expect(invitaciones).toHaveLength(1);

      await api(app).get(`/api/v1/vacantes/${id}`).set(auth(candidato)).expect(200);
    });

    it('aceptar dos veces no se reescribe', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);
      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/aceptar`)
        .set(auth(reclutador))
        .expect(200);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/aceptar`)
        .set(auth(reclutador))
        .expect(400);
      expect(body.mensaje).toMatch(/ya esta aceptada/i);
    });

    it('un reclutador de otra empresa no acepta a nadie, y recibe 404', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);

      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/aceptar`)
        .set(auth(otroReclutador))
        .expect(404);

      // Y no ha invitado a nadie por el camino.
      const invitaciones = await consultar(
        `select 1 from vacantes.vacante_candidatos where id_vacante = $1`,
        [id],
      );
      expect(invitaciones).toHaveLength(0);
    });

    it('no se acepta a quien no se postulo', async () => {
      const id = await vacantePublicada();
      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/aceptar`)
        .set(auth(reclutador))
        .expect(404);
    });

    it('con la vacante cerrada no se acepta: seria dar un reto que no se evaluara', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);
      await api(app).post(`/api/v1/vacantes/${id}/cerrar`).set(auth(reclutador)).expect(200);

      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/aceptar`)
        .set(auth(reclutador))
        .expect(400);
    });
  });

  describe('rechazar', () => {
    it('exige un motivo: "no" no es una respuesta', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);

      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/rechazar`)
        .set(auth(reclutador))
        .send({})
        .expect(400);

      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/rechazar`)
        .set(auth(reclutador))
        .send({ motivo: 'no' })
        .expect(400);

      // Y la postulacion sigue en revision: un rechazo invalido no decide nada.
      const [fila] = await consultar<{ estado: string }>(
        `select estado from vacantes.postulaciones where id_vacante = $1`,
        [id],
      );
      expect(fila.estado).toBe('en_revision');
    });

    it('deja quien decidio y cuando, y no invita a nadie', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);

      const { body } = await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/rechazar`)
        .set(auth(reclutador))
        .send({ motivo: MOTIVO })
        .expect(200);
      expect(body).toMatchObject({ estado: 'rechazada', idUsuarioQueDecidio: reclutador.id });
      expect(body.decididaEn).not.toBeNull();

      const invitaciones = await consultar(
        `select 1 from vacantes.vacante_candidatos where id_vacante = $1`,
        [id],
      );
      expect(invitaciones).toHaveLength(0);
    });

    it('rechazar y luego aceptar no se puede: el candidato ya recibio el motivo', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);
      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/rechazar`)
        .set(auth(reclutador))
        .send({ motivo: MOTIVO })
        .expect(200);

      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/aceptar`)
        .set(auth(reclutador))
        .expect(400);
    });

    it('pero el reclutador puede invitarlo igual: es un acto nuevo, no deshacer el viejo', async () => {
      const id = await vacantePublicada();
      await api(app).post(`/api/v1/vacantes/${id}/postular`).set(auth(candidato)).expect(201);
      await api(app)
        .post(`/api/v1/vacantes/${id}/postulaciones/${candidato.id}/rechazar`)
        .set(auth(reclutador))
        .send({ motivo: MOTIVO })
        .expect(200);

      await api(app)
        .post(`/api/v1/vacantes/${id}/candidatos`)
        .set(auth(reclutador))
        .send({ idCandidato: candidato.id })
        .expect(200);

      await api(app).get(`/api/v1/vacantes/${id}`).set(auth(candidato)).expect(200);

      // Y la postulacion sigue contando lo que paso: rechazada.
      const [fila] = await consultar<{ estado: string }>(
        `select estado from vacantes.postulaciones where id_vacante = $1`,
        [id],
      );
      expect(fila.estado).toBe('rechazada');
    });
  });
});
