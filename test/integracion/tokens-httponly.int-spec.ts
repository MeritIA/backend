import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import { api, levantarAplicacion } from './ayudas.js';

/**
 * Criterio de aceptacion del paquete 3.5, en su mitad de backend:
 * "el token no es legible desde JavaScript en la version web".
 *
 * La mitad de cliente —KeyStore en la APK y certificate pinning— vive en el
 * proyecto de Angular y no se puede probar desde aqui.
 */
describe('integracion: entrega de tokens por tipo de cliente', () => {
  let app: INestApplication<Server>;

  const credenciales = {
    correo: 'ana@ejemplo.com',
    contrasena: 'una-frase-larga-y-dificil',
    nombreCompleto: 'Ana Torres',
  };

  /** Todas las cookies Set-Cookie de una respuesta. */
  const cookiesDe = (r: { headers: Record<string, unknown> }): string[] => {
    const c = r.headers['set-cookie'];
    return Array.isArray(c) ? (c as string[]) : c ? [c as string] : [];
  };

  const cookie = (r: { headers: Record<string, unknown> }, nombre: string): string | undefined =>
    cookiesDe(r).find((c) => c.startsWith(`${nombre}=`));

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

  describe('CRITERIO: en web el token no es legible desde JavaScript', () => {
    it('el cuerpo de la respuesta NO trae los tokens', async () => {
      const { body } = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send(credenciales)
        .expect(201);

      // Lo central del criterio: si el token viniera aqui, un XSS lo leeria de
      // la respuesta del login y la cookie HttpOnly no habria servido de nada.
      expect(body.tokenDeAcceso).toBeUndefined();
      expect(body.tokenDeRenovacion).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('v4.public.');

      // Lo que si necesita el frontend para pintar la interfaz.
      expect(body.rol).toBe('candidato');
      expect(body.idUsuario).toBeDefined();
      expect(body.expiraEn).toBeDefined();
    });

    it('los tokens llegan en cookies con HttpOnly, SameSite=Strict y Path', async () => {
      const r = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send(credenciales)
        .expect(201);

      for (const nombre of ['meritia_acceso', 'meritia_renovacion']) {
        const c = cookie(r, nombre);
        expect(c, `falta la cookie ${nombre}`).toBeDefined();
        expect(c).toMatch(/HttpOnly/i);
        expect(c).toMatch(/SameSite=Strict/i);
        expect(c).toMatch(/Path=\//);
        expect(c).toContain('v4.public.');
      }
    });

    it('la sesion funciona solo con la cookie, sin cabecera Authorization', async () => {
      const r = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send(credenciales)
        .expect(201);
      const galletas = cookiesDe(r).map((c) => c.split(';')[0]);

      const { body } = await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Cookie', galletas)
        .expect(200);
      expect(body.rol).toBe('candidato');
    });

    it('sin cookie ni cabecera, 401', async () => {
      await api(app).post('/api/v1/autenticacion/registro').send(credenciales).expect(201);
      await api(app).get('/api/v1/autenticacion/yo').expect(401);
    });

    it('una cookie manipulada se rechaza con 401', async () => {
      const r = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send(credenciales)
        .expect(201);
      const acceso = cookie(r, 'meritia_acceso')!.split(';')[0];

      // Se altera un caracter del MEDIO del token, no el ultimo.
      //
      // El intento anterior cambiaba el ultimo y solo evitaba la 'X'. Eso
      // bajaba la intermitencia sin quitarla: en base64url el ultimo caracter
      // arrastra bits sobrantes y, segun la longitud, hasta cuatro caracteres
      // distintos decodifican los MISMOS bytes. Cuando tocaba uno de esos, el
      // token seguia siendo valido y la respuesta era 200. Un caracter del
      // medio usa sus seis bits, asi que cambiarlo siempre cambia la firma.
      const [nombre, valor] = acceso.split('=');
      const medio = Math.floor(valor.length / 2);
      const alterado =
        valor.slice(0, medio) + (valor[medio] === 'a' ? 'b' : 'a') + valor.slice(medio + 1);
      await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Cookie', [`${nombre}=${alterado}`])
        .expect(401);
    });

    it('renovar funciona con la cookie, sin enviar el token en el cuerpo', async () => {
      const r = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send(credenciales)
        .expect(201);
      const galletas = cookiesDe(r).map((c) => c.split(';')[0]);

      const renovada = await api(app)
        .post('/api/v1/autenticacion/renovar')
        .set('Cookie', galletas)
        .send({})
        .expect(200);

      expect(renovada.body.tokenDeAcceso).toBeUndefined();
      expect(cookie(renovada, 'meritia_acceso')).toBeDefined();
    });

    it('cerrar sesiones borra las cookies del navegador', async () => {
      const r = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send(credenciales)
        .expect(201);
      const galletas = cookiesDe(r).map((c) => c.split(';')[0]);

      const cerrada = await api(app)
        .post('/api/v1/autenticacion/cerrar-sesiones')
        .set('Cookie', galletas)
        .expect(204);

      // Sin esto el navegador seguiria mandando una cookie ya invalidada y
      // recibiendo 401 sin entender por que.
      for (const nombre of ['meritia_acceso', 'meritia_renovacion']) {
        expect(cookie(cerrada, nombre), `no se borro ${nombre}`).toBeDefined();
      }
      await api(app).get('/api/v1/autenticacion/yo').set('Cookie', galletas).expect(401);
    });
  });

  describe('en APK los tokens vienen en el cuerpo', () => {
    it('devuelve los dos tokens y NO pone cookies', async () => {
      const r = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({ ...credenciales, cliente: 'apk' })
        .expect(201);

      expect(r.body.tokenDeAcceso).toMatch(/^v4\.public\./);
      expect(r.body.tokenDeRenovacion).toMatch(/^v4\.public\./);
      // El almacen de cookies del WebView no es almacenamiento seguro del
      // sistema: la APK guarda el token ella misma en el KeyStore.
      expect(cookiesDe(r)).toHaveLength(0);
    });

    it('la sesion funciona con la cabecera Authorization', async () => {
      const r = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({ ...credenciales, cliente: 'apk' })
        .expect(201);

      await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Authorization', `Bearer ${r.body.tokenDeAcceso}`)
        .expect(200);
    });

    it('renovar en apk devuelve el token nuevo en el cuerpo', async () => {
      const r = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({ ...credenciales, cliente: 'apk' })
        .expect(201);

      const renovada = await api(app)
        .post('/api/v1/autenticacion/renovar')
        .send({ tokenDeRenovacion: r.body.tokenDeRenovacion, cliente: 'apk' })
        .expect(200);

      expect(renovada.body.tokenDeAcceso).toMatch(/^v4\.public\./);
      expect(cookiesDe(renovada)).toHaveLength(0);
    });
  });

  describe('el valor por omision es el seguro', () => {
    it('un cliente que no declara nada recibe cookie, no token en el cuerpo', async () => {
      // Equivocarse al otro lado significaria entregarle el token en el JSON a
      // un navegador, que es justo lo que el criterio prohibe.
      const r = await api(app).post('/api/v1/autenticacion/login').send({
        correo: credenciales.correo,
        contrasena: credenciales.contrasena,
      });

      await api(app).post('/api/v1/autenticacion/registro').send(credenciales).expect(201);

      const login = await api(app)
        .post('/api/v1/autenticacion/login')
        .send({ correo: credenciales.correo, contrasena: credenciales.contrasena })
        .expect(200);

      expect(login.body.tokenDeAcceso).toBeUndefined();
      expect(cookie(login, 'meritia_acceso')).toBeDefined();
      expect(r.status).toBe(401); // antes de registrarse, no existia
    });

    it('un valor de cliente invalido se rechaza con 400', async () => {
      await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({ ...credenciales, cliente: 'escritorio' })
        .expect(400);
    });
  });
});
