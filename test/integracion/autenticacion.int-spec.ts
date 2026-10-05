import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrar, prepararEntorno, vaciarTablas } from './entorno.js';
import { api, consultar, crearConRol, levantarAplicacion, registrarCandidato } from './ayudas.js';

/**
 * Criterios de aceptacion del paquete 2.1, automatizados.
 *
 * Estos mismos casos se comprobaron a mano con curl al construir el paquete.
 * Aquella verificacion demostro que funcionaba una vez; esta lo vuelve a
 * demostrar en cada ejecucion, que es lo que exige el encuadre: "cada bug
 * importante descubierto genera una prueba de regresion".
 */
describe('integracion: autenticacion', () => {
  let app: INestApplication<Server>;

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

  describe('registro', () => {
    it('crea un candidato y devuelve la sesion', async () => {
      const { body } = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({
          correo: 'ana@ejemplo.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Ana Torres',
          // Los tokens solo vienen en el cuerpo para la APK; el camino web
          // tiene sus propias pruebas en tokens-httponly.int-spec.ts.
          cliente: 'apk',
        })
        .expect(201);

      expect(body.rol).toBe('candidato');
      expect(body.tokenDeAcceso).toMatch(/^v4\.public\./);
      expect(body.tokenDeRenovacion).toMatch(/^v4\.public\./);
      expect(new Date(body.expiraEn).getTime()).toBeGreaterThan(Date.now());
    });

    it('CIFRA la informacion personal en reposo', async () => {
      await registrarCandidato(app, 'ana@ejemplo.com', 'Ana Maria Torres');

      const filas = await consultar<{ correo: string; nombre_completo: string }>(
        'select correo, nombre_completo from autenticacion.usuarios',
      );

      // Lo que importa no es que el endpoint responda, sino lo que queda escrito.
      expect(filas[0].correo).not.toContain('ana@ejemplo.com');
      expect(filas[0].nombre_completo).not.toContain('Ana Maria');
      // Formato iv:authTag:ciphertext del Plan de Seguridad §5.2.
      expect(filas[0].correo.split(':')).toHaveLength(3);
    });

    it('NUNCA guarda la contrasena, ni cifrada ni en claro', async () => {
      await registrarCandidato(app, 'ana@ejemplo.com');
      const [fila] = await consultar<{ contrasena_hash: string }>(
        'select contrasena_hash from autenticacion.usuarios',
      );
      expect(fila.contrasena_hash).not.toContain('una-frase-larga');
      expect(fila.contrasena_hash.split('$')[1]).toBe('argon2id');
    });

    it('rechaza un correo ya registrado', async () => {
      await registrarCandidato(app, 'ana@ejemplo.com');
      await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({
          correo: 'ana@ejemplo.com',
          contrasena: 'otra-frase-larga-distinta',
          nombreCompleto: 'Otra Persona',
        })
        .expect(409);
    });

    it('trata el correo sin distinguir mayusculas ni espacios', async () => {
      await registrarCandidato(app, 'ana@ejemplo.com');
      await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({
          correo: '  ANA@Ejemplo.COM  ',
          contrasena: 'otra-frase-larga-distinta',
          nombreCompleto: 'Duplicada',
        })
        .expect(409);
    });

    it('IMPIDE elegirse el rol: no se crea un administrador desde el registro', async () => {
      await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({
          correo: 'atacante@ejemplo.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Atacante',
          rol: 'administrador',
        })
        .expect(400);

      expect(await consultar('select 1 from autenticacion.usuarios')).toHaveLength(0);
    });

    it('rechaza campos que el DTO no declara', async () => {
      await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({
          correo: 'ana@ejemplo.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Ana',
          activo: true,
          id: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });

    it('devuelve el detalle de validacion agrupado por campo', async () => {
      const { body } = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({ correo: 'no-es-correo', contrasena: 'corta', nombreCompleto: '' })
        .expect(400);

      expect(body.codigo).toBe('VALIDACION_FALLIDA');
      expect(body.errores.map((e: { campo: string }) => e.campo)).toEqual(
        expect.arrayContaining(['correo', 'contrasena']),
      );
      // Criterio del paquete 2.4: sin informacion interna.
      expect(JSON.stringify(body)).not.toMatch(/usuarios|postgres|at \w+ \(/);
    });
  });

  describe('inicio de sesion', () => {
    beforeEach(async () => {
      await registrarCandidato(app, 'ana@ejemplo.com');
    });

    it('entra con las credenciales correctas', async () => {
      const { body } = await api(app)
        .post('/api/v1/autenticacion/login')
        .send({
          correo: 'ana@ejemplo.com',
          contrasena: 'una-frase-larga-y-dificil',
          cliente: 'apk',
        })
        .expect(200);
      expect(body.tokenDeAcceso).toMatch(/^v4\.public\./);
    });

    it('NO permite averiguar que correos estan registrados', async () => {
      const conCuenta = await api(app)
        .post('/api/v1/autenticacion/login')
        .send({ correo: 'ana@ejemplo.com', contrasena: 'incorrecta-del-todo' })
        .expect(401);

      const sinCuenta = await api(app)
        .post('/api/v1/autenticacion/login')
        .send({ correo: 'nadie@ejemplo.com', contrasena: 'incorrecta-del-todo' })
        .expect(401);

      // Misma respuesta: si difirieran, probar correos revelaria quien tiene cuenta.
      expect(conCuenta.body.mensaje).toBe(sinCuenta.body.mensaje);
      expect(conCuenta.body.codigo).toBe(sinCuenta.body.codigo);
    });

    it('rechaza a un usuario desactivado', async () => {
      await consultar('update autenticacion.usuarios set activo = false');
      await api(app)
        .post('/api/v1/autenticacion/login')
        .send({ correo: 'ana@ejemplo.com', contrasena: 'una-frase-larga-y-dificil' })
        .expect(401);
    });
  });

  describe('tokens', () => {
    it('CRITERIO: un token manipulado se rechaza con 401', async () => {
      const { token } = await registrarCandidato(app, 'ana@ejemplo.com');

      await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Se altera un caracter del MEDIO, no el ultimo.
      //
      // El intento anterior cambiaba el ultimo evitando la 'X'. Eso bajaba la
      // intermitencia sin quitarla: en base64url el ultimo caracter arrastra
      // bits sobrantes y, segun la longitud, varios caracteres distintos
      // decodifican los MISMOS bytes. Cuando tocaba uno de esos, el token
      // seguia siendo valido. Un caracter del medio usa sus seis bits.
      const enMedio = (t: string): string => {
        const i = Math.floor(t.length / 2);
        return t.slice(0, i) + (t[i] === 'a' ? 'b' : 'a') + t.slice(i + 1);
      };
      const primeroDistinto = (c: string): string => (c === 'X' ? 'Y' : 'X');
      for (const roto of [
        enMedio(token),
        `${primeroDistinto(token[0])}${token.slice(1)}`,
        'v4.public.inventado',
      ]) {
        await api(app)
          .get('/api/v1/autenticacion/yo')
          .set('Authorization', `Bearer ${roto}`)
          .expect(401);
      }
    });

    it('exige el esquema Bearer', async () => {
      const { token } = await registrarCandidato(app, 'ana@ejemplo.com');
      await api(app).get('/api/v1/autenticacion/yo').set('Authorization', token).expect(401);
      await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Authorization', `Basic ${token}`)
        .expect(401);
      await api(app).get('/api/v1/autenticacion/yo').expect(401);
    });

    it('un token de renovacion NO sirve para consumir la API', async () => {
      const { body } = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({
          correo: 'ana@ejemplo.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Ana',
        })
        .expect(201);

      await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Authorization', `Bearer ${body.tokenDeRenovacion}`)
        .expect(401);
    });

    it('renueva la sesion, y un token de acceso no vale para renovar', async () => {
      const { body } = await api(app)
        .post('/api/v1/autenticacion/registro')
        .send({
          correo: 'ana@ejemplo.com',
          contrasena: 'una-frase-larga-y-dificil',
          nombreCompleto: 'Ana',
          cliente: 'apk',
        })
        .expect(201);

      await api(app)
        .post('/api/v1/autenticacion/renovar')
        .send({ tokenDeRenovacion: body.tokenDeRenovacion })
        .expect(200);

      await api(app)
        .post('/api/v1/autenticacion/renovar')
        .send({ tokenDeRenovacion: body.tokenDeAcceso })
        .expect(401);
    });

    it('DESACTIVAR la cuenta invalida un token que seguia siendo valido', async () => {
      const { token } = await registrarCandidato(app, 'ana@ejemplo.com');
      await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await consultar('update autenticacion.usuarios set activo = false');

      // El token no ha expirado y su firma sigue siendo correcta: lo que corta
      // el acceso es la consulta a la base en cada peticion.
      await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('cerrar todas las sesiones invalida los tokens ya emitidos', async () => {
      const { token } = await registrarCandidato(app, 'ana@ejemplo.com');

      await api(app)
        .post('/api/v1/autenticacion/cerrar-sesiones')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await api(app)
        .get('/api/v1/autenticacion/yo')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  describe('roles', () => {
    it('CRITERIO: un candidato no accede a recursos de reclutador', async () => {
      const candidato = await registrarCandidato(app, 'cand@ejemplo.com');

      await api(app)
        .post('/api/v1/vacantes')
        .set('Authorization', `Bearer ${candidato.token}`)
        .send({ titulo: 'Vacante falsa', descripcion: 'Un candidato intentando crear una oferta.' })
        .expect(403);
    });

    it('un reclutador si puede', async () => {
      const reclutador = await crearConRol(app, 'recl@ejemplo.com', 'reclutador');

      await api(app)
        .post('/api/v1/vacantes')
        .set('Authorization', `Bearer ${reclutador.token}`)
        .send({ titulo: 'Backend junior', descripcion: 'Descripcion suficientemente larga.' })
        .expect(201);
    });
  });

  describe('endpoints publicos', () => {
    it('la senal de vida responde sin token', async () => {
      const { body } = await api(app).get('/api/salud').expect(200);
      expect(body.estado).toBe('vivo');
    });

    it('todo lo demas exige token: protegido por omision', async () => {
      await api(app).get('/api/v1/vacantes').expect(401);
      await api(app).get('/api/v1/autenticacion/yo').expect(401);
    });
  });
});
