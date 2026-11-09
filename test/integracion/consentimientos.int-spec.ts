import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
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
 * El registro de consentimientos (pantallas B12 y B24), contra PostgreSQL.
 *
 * Lo que se prueba aqui no es que una casilla se guarde: es que la tabla
 * pueda responder lo que la Ley 1581 obliga a poder responder. Quien
 * autorizo que, desde cuando, a que texto, y desde donde lo decidio.
 */
describe('integracion: consentimientos del titular', () => {
  let app: INestApplication<Server>;

  let ana: Sesion;
  let luis: Sesion;
  let reclutador: Sesion;

  const auth = (s: Sesion) => ({ Authorization: `Bearer ${s.token}` });
  const RUTA = '/api/v1/autenticacion/consentimientos';

  const mios = (quien: Sesion) => api(app).get(RUTA).set(auth(quien));

  const decidir = (quien: Sesion, cuerpo: unknown) =>
    api(app).put(RUTA).set(auth(quien)).send(cuerpo);

  interface Permiso {
    tipo: string;
    concedido: boolean;
    porOmision: boolean;
    decididoEn: string | null;
    versionDelAviso: string | null;
    vigilado: boolean;
  }

  const porTipo = (cuerpo: { permisos: Permiso[] }): Map<string, Permiso> =>
    new Map(cuerpo.permisos.map((p) => [p.tipo, p]));

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
    ana = await registrarCandidato(app, 'ana@ejemplo.com', 'Ana Maria Rojas');
    luis = await registrarCandidato(app, 'luis@ejemplo.com', 'Luis Perez');
    reclutador = await crearConRol(app, 'laura@empresa-a.com', 'reclutador', 'Empresa A');
  }, 60_000);

  describe('el catalogo que la pantalla pinta', () => {
    it('devuelve las tres finalidades del Taller 2 aunque no se haya decidido ninguna', async () => {
      const { body } = await mios(ana).expect(200);

      expect(body.permisos).toHaveLength(3);
      expect(body.permisos.map((p: Permiso) => p.tipo)).toEqual([
        'biometria',
        'calificacion_ia',
        'perfil_publico',
      ]);
      // La pantalla tiene que poder pintar los cuatro interruptores sin saber
      // cuales se guardaron alguna vez.
      for (const permiso of body.permisos as Permiso[]) {
        expect(permiso.porOmision).toBe(true);
        expect(permiso.decididoEn).toBeNull();
        expect(permiso.versionDelAviso).toBeNull();
      }
    });

    it('los valores iniciales son los que muestra B12', async () => {
      const { body } = await mios(ana).expect(200);
      const permisos = porTipo(body);

      expect(permisos.get('biometria')?.concedido).toBe(true);
      expect(permisos.get('calificacion_ia')?.concedido).toBe(true);
      // El unico que B12 marca "Opcional", apagado en la pantalla. Y lo que
      // decide que nazca apagado NO es la pantalla: el paso 13 del BPM publica
      // el perfil de todo el mundo, y manda el Taller 2 (D-18).
      expect(permisos.get('perfil_publico')?.concedido).toBe(false);
    });

    it('declara cual hace cumplir y cuales no', async () => {
      const { body } = await mios(ana).expect(200);
      const vigilados = (body.permisos as Permiso[]).filter((p) => p.vigilado).map((p) => p.tipo);

      // Prometer control sobre algo que nadie vigila es peor que no prometerlo,
      // asi que la respuesta lo dice permiso por permiso.
      expect(vigilados).toEqual(['biometria', 'calificacion_ia', 'perfil_publico']);
      expect(body.versionDelAviso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('cada permiso viaja con el texto que el titular acepta', async () => {
      const { body } = await mios(ana).expect(200);
      const biometria = porTipo(body).get('biometria') as unknown as {
        titulo: string;
        descripcion: string;
        efecto: string;
      };

      expect(biometria.titulo).toMatch(/biometrica/i);
      expect(biometria.descripcion).toMatch(/90 dias/);
      expect(biometria.efecto).toMatch(/manual/i);
    });
  });

  describe('decidir y revocar', () => {
    it('guarda la decision y la devuelve con su momento y su version', async () => {
      const { body } = await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
        origen: 'registro',
      }).expect(200);

      expect(body.registradas).toBe(1);
      const permiso = porTipo(body).get('perfil_publico');
      expect(permiso?.concedido).toBe(true);
      expect(permiso?.porOmision).toBe(false);
      expect(permiso?.decididoEn).not.toBeNull();
      expect(permiso?.versionDelAviso).toBe(body.versionDelAviso);
    });

    it('revocar NO borra la decision anterior: deja las dos filas', async () => {
      await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
        origen: 'registro',
      }).expect(200);
      await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: false }],
      }).expect(200);

      const filas = await consultar<{ concedido: boolean; origen: string }>(
        `select concedido, origen from autenticacion.consentimientos
          where id_usuario = $1 and tipo = 'perfil_publico'
          order by registrado_en asc`,
        [ana.id],
      );

      // Borrar el rastro de un consentimiento es perder la prueba de que
      // existio, que es justo lo que esta tabla guarda.
      expect(filas).toHaveLength(2);
      expect(filas[0]).toMatchObject({ concedido: true, origen: 'registro' });
      expect(filas[1]).toMatchObject({ concedido: false, origen: 'perfil' });

      const { body } = await mios(ana).expect(200);
      expect(porTipo(body).get('perfil_publico')?.concedido).toBe(false);
    });

    it('repetir la misma decision no guarda nada', async () => {
      await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
      }).expect(200);

      const { body } = await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
      }).expect(200);

      // Cien filas identicas harian mas dificil, no mas facil, responder
      // "desde cuando autoriza esto".
      expect(body.registradas).toBe(0);
      expect(porTipo(body).get('perfil_publico')?.concedido).toBe(true);

      const [{ total }] = await consultar<{ total: string }>(
        `select count(*)::int as total from autenticacion.consentimientos
          where id_usuario = $1 and tipo = 'perfil_publico'`,
        [ana.id],
      );
      expect(Number(total)).toBe(1);
    });

    it('decidir igual que el valor inicial SI se guarda: no es lo mismo que no decidir', async () => {
      // biometria nace en true. Aceptarlo explicitamente en B12 es un acto de
      // voluntad, y la ley pide poder demostrarlo; el valor por omision no lo
      // demuestra.
      const { body } = await decidir(ana, {
        decisiones: [{ tipo: 'biometria', concedido: true }],
        origen: 'registro',
      }).expect(200);

      expect(body.registradas).toBe(1);
      expect(porTipo(body).get('biometria')?.porOmision).toBe(false);
    });

    it('las tres decisiones de B12 entran juntas', async () => {
      const { body } = await decidir(ana, {
        decisiones: [
          { tipo: 'biometria', concedido: true },
          { tipo: 'calificacion_ia', concedido: true },
          { tipo: 'perfil_publico', concedido: false },
        ],
        origen: 'registro',
      }).expect(200);

      expect(body.registradas).toBe(3);
      const filas = await consultar<{ origen: string }>(
        `select origen from autenticacion.consentimientos where id_usuario = $1`,
        [ana.id],
      );
      expect(filas).toHaveLength(3);
      expect(filas.every((f) => f.origen === 'registro')).toBe(true);
    });

    it('el origen por omision es el perfil', async () => {
      await decidir(ana, { decisiones: [{ tipo: 'perfil_publico', concedido: true }] }).expect(200);

      const [fila] = await consultar<{ origen: string }>(
        `select origen from autenticacion.consentimientos where id_usuario = $1`,
        [ana.id],
      );
      expect(fila.origen).toBe('perfil');
    });
  });

  describe('lo que no se acepta', () => {
    it('rechaza el mismo permiso dos veces en una llamada', async () => {
      const { body } = await decidir(ana, {
        decisiones: [
          { tipo: 'perfil_publico', concedido: true },
          { tipo: 'perfil_publico', concedido: false },
        ],
      }).expect(400);

      // Quedarse con la ultima seria adivinar cual queria la persona.
      expect(body.mensaje).toMatch(/dos veces/i);
    });

    it('rechaza una finalidad retirada: el historial se lee, no se reescribe', async () => {
      // `mentor_ia` sigue en el enum para poder leer filas viejas, pero ya no
      // se ofrece: aparecia en el panel de B24 y en ningun documento mas.
      const { body } = await decidir(ana, {
        decisiones: [{ tipo: 'mentor_ia', concedido: true }],
      }).expect(400);

      expect(body.mensaje).toMatch(/ya no se pide/i);
    });

    it('rechaza un permiso inventado, una decision sin booleano y una lista vacia', async () => {
      await decidir(ana, { decisiones: [{ tipo: 'lo_que_sea', concedido: true }] }).expect(400);
      await decidir(ana, { decisiones: [{ tipo: 'perfil_publico', concedido: 'si' }] }).expect(400);
      await decidir(ana, { decisiones: [] }).expect(400);
      await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
        origen: 'x',
      }).expect(400);
    });

    it('no deja colar campos de mas', async () => {
      // Con forbidNonWhitelisted, mandar `idUsuario` es 400 y no un cambio
      // silencioso sobre otra persona.
      await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
        idUsuario: luis.id,
      }).expect(400);
    });
  });

  describe('cada quien ve y cambia lo suyo', () => {
    it('la decision de una persona no toca la de otra', async () => {
      await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
      }).expect(200);

      const { body } = await mios(luis).expect(200);
      expect(porTipo(body).get('perfil_publico')?.concedido).toBe(false);
      expect(porTipo(body).get('perfil_publico')?.porOmision).toBe(true);
    });

    it('un reclutador tambien es titular de sus datos', async () => {
      // La Ley 1581 no reparte este derecho por rol: exigir un permiso de la
      // matriz aqui dejaria a un reclutador sin poder revocar nada sobre si.
      const { body } = await decidir(reclutador, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
      }).expect(200);

      expect(body.registradas).toBe(1);
    });

    it('sin sesion no se ve ni se cambia nada', async () => {
      await api(app).get(RUTA).expect(401);
      await api(app).put(RUTA).send({ decisiones: [] }).expect(401);
    });

    it('no hay ruta para ver ni cambiar los de otra persona', async () => {
      // Ni siquiera para un administrador: el usuario sale del token y nunca
      // de la URL, asi que no hay identificador que cambiar.
      await api(app).get(`${RUTA}/${luis.id}`).set(auth(ana)).expect(404);
      await api(app).put(`${RUTA}/${luis.id}`).set(auth(ana)).send({ decisiones: [] }).expect(404);
    });
  });

  describe('el historial responde lo que la ley pregunta', () => {
    it('conserva a que version del aviso dijo que si', async () => {
      await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
        origen: 'registro',
      }).expect(200);

      const [fila] = await consultar<{ version_del_aviso: string }>(
        `select version_del_aviso from autenticacion.consentimientos where id_usuario = $1`,
        [ana.id],
      );

      // Sin esto, un "si" de hace un año no dice a que dijo que si.
      expect(fila.version_del_aviso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('deja reconstruir el orden de las decisiones', async () => {
      for (const concedido of [true, false, true]) {
        await decidir(ana, { decisiones: [{ tipo: 'perfil_publico', concedido }] }).expect(200);
      }

      const filas = await consultar<{ concedido: boolean }>(
        `select concedido from autenticacion.consentimientos
          where id_usuario = $1 and tipo = 'perfil_publico'
          order by registrado_en asc, concedido desc`,
        [ana.id],
      );

      expect(filas.map((f) => f.concedido)).toEqual([true, false, true]);
    });

    it('no guarda la IP ni el navegador', async () => {
      await decidir(ana, {
        decisiones: [{ tipo: 'perfil_publico', concedido: true }],
      }).expect(200);

      const [fila] = await consultar<Record<string, unknown>>(
        `select * from autenticacion.consentimientos where id_usuario = $1`,
        [ana.id],
      );

      // Recoger una IP "por si acaso" dentro del registro que existe para no
      // recoger de mas seria contradecirse.
      expect(Object.keys(fila).sort()).toEqual([
        'concedido',
        'id',
        'id_usuario',
        'origen',
        'registrado_en',
        'tipo',
        'version_del_aviso',
      ]);
    });
  });
});
