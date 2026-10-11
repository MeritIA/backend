import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar, prepararEntorno } from './entorno.js';
import { consultar, levantarAplicacion } from './ayudas.js';
import {
  AlmacenamientoService,
  ArchivoInvalidoError,
  ClaveInvalidaError,
  ObjetoNoEncontradoError,
  type ReferenciaDeObjeto,
} from '../../src/common/almacenamiento/index.js';

/**
 * Criterios de aceptacion del paquete 3.3, contra MinIO de verdad.
 *
 *  1. Una entrega se sube y se recupera por su referencia.
 *  2. Ningun binario se persiste en PostgreSQL.
 *  3. El bucket no es publicamente accesible desde internet.
 */
describe('integracion: almacenamiento de objetos', () => {
  let app: INestApplication<Server>;
  let almacen: AlmacenamientoService;

  const VACANTE = crypto.randomUUID();
  const ENTREGA = crypto.randomUUID();

  beforeAll(async () => {
    await prepararEntorno();
    await migrar();
    app = await levantarAplicacion();
    almacen = app.get(AlmacenamientoService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('CRITERIO: se sube y se recupera por su referencia', () => {
    it('lo que se descarga es byte a byte lo que se subio', async () => {
      const contenido = Buffer.from('print("hola, soy la solucion del candidato")\n'.repeat(50));
      const ref = await almacen.subirEntrega(
        VACANTE,
        ENTREGA,
        'solucion.zip',
        contenido,
        'application/zip',
      );

      const descargado = await almacen.descargar(ref);
      expect(descargado.equals(contenido)).toBe(true);
    });

    it('la referencia trae lo necesario para guardarla: clave, tamano, hash, tipo y nombre', async () => {
      const contenido = Buffer.from('%PDF-1.4 informe');
      const ref = await almacen.subirEntrega(
        VACANTE,
        ENTREGA,
        'Mi Informé.pdf',
        contenido,
        'application/pdf',
      );

      expect(ref.clave).toMatch(new RegExp(`^entregas/${VACANTE}/${ENTREGA}/[0-9a-f-]{36}\\.pdf$`));
      expect(ref.bytes).toBe(contenido.length);
      expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(ref.nombreOriginal).toBe('Mi Informé.pdf');
    });

    it('un archivo con contenido binario real no se corrompe por el camino', async () => {
      // randomBytes y no crypto.getRandomValues: la API web limita cada llamada
      // a 65.536 bytes, y aqui interesa un archivo de tamano realista.
      const binario = randomBytes(200_000);
      const ref = await almacen.subirEntrega(
        VACANTE,
        ENTREGA,
        'datos.tgz',
        binario,
        'application/gzip',
      );
      expect((await almacen.descargar(ref)).equals(binario)).toBe(true);
    });

    it('el enlace prefirmado descarga el archivo sin credenciales, durante un rato', async () => {
      const contenido = Buffer.from('contenido accesible solo con enlace firmado');
      const ref = await almacen.subirEntrega(VACANTE, ENTREGA, 'nota.txt', contenido, 'text/plain');

      const enlace = await almacen.enlaceDeDescarga(ref);
      const r = await fetch(enlace);
      expect(r.status).toBe(200);
      expect(Buffer.from(await r.arrayBuffer()).equals(contenido)).toBe(true);
      // Obliga a descargar en vez de abrir dentro del origen de la aplicacion.
      expect(r.headers.get('content-disposition')).toMatch(/attachment/);
    });

    it('un enlace firmado alterado no sirve', async () => {
      const ref = await almacen.subirEntrega(
        VACANTE,
        ENTREGA,
        'nota.txt',
        Buffer.from('x'),
        'text/plain',
      );
      const enlace = await almacen.enlaceDeDescarga(ref);
      // El caracter de reemplazo se elige DISTINTO del original. Con un '0'
      // fijo, una firma que ya empezara por '0' quedaba intacta: una vez de
      // cada dieciseis la URL seguia siendo valida y esta prueba pasaba sin
      // comprobar nada. En una prueba de seguridad eso es lo peor que puede
      // pasar, porque el verde no significa nada.
      const alterado = enlace.replace(
        /(X-Amz-Signature=)([0-9a-f])/,
        (_coincidencia, prefijo: string, primero: string) =>
          `${prefijo}${primero === '0' ? '1' : '0'}`,
      );
      expect((await fetch(alterado)).status).toBe(403);
    });
  });

  describe('CRITERIO: el bucket no es publicamente accesible', () => {
    it('bucketEsPrivado lo confirma contra el servidor', async () => {
      expect(await almacen.bucketEsPrivado()).toBe(true);
    });

    it('sin firma, un objeto que existe NO se puede leer', async () => {
      // Es la prueba que importa: lo que haria alguien desde internet con la
      // URL de un objeto concreto.
      const ref = await almacen.subirEntrega(
        VACANTE,
        ENTREGA,
        'privado.txt',
        Buffer.from('secreto'),
        'text/plain',
      );
      const directo = `${process.env.S3_ENDPOINT}/${almacen.bucket}/${ref.clave}`;
      expect([401, 403]).toContain((await fetch(directo)).status);
    });

    it('sin firma, tampoco se puede listar el bucket', async () => {
      const listado = await fetch(`${process.env.S3_ENDPOINT}/${almacen.bucket}/?list-type=2`);
      expect([401, 403]).toContain(listado.status);
    });
  });

  describe('CRITERIO: ningun binario se persiste en PostgreSQL', () => {
    it('ninguna columna de la base de datos es de tipo binario', async () => {
      // Se comprueba el esquema entero, no una tabla: la regla es de la base
      // de datos, y un bytea que alguien anada manana en otro modulo tambien
      // la rompe.
      const binarias = await consultar<{ tabla: string; columna: string }>(
        `select table_schema || '.' || table_name as tabla, column_name as columna
           from information_schema.columns
          where table_schema in ('autenticacion','vacantes','ejercicios','entregas','evaluacion','reportes')
            and data_type in ('bytea','oid')`,
      );
      expect(binarias).toEqual([]);
    });
  });

  describe('defensas', () => {
    it('rechaza extensiones fuera de la lista blanca antes de subir', async () => {
      await expect(
        almacen.subirEntrega(VACANTE, ENTREGA, 'pagina.html', Buffer.from('<script>'), 'text/html'),
      ).rejects.toThrow(ArchivoInvalidoError);
    });

    it('rechaza archivos vacios', async () => {
      await expect(
        almacen.subirEntrega(VACANTE, ENTREGA, 'vacio.zip', Buffer.alloc(0), 'application/zip'),
      ).rejects.toThrow(ArchivoInvalidoError);
    });

    it('no sirve una referencia que se sale del arbol previsto', async () => {
      const mala: ReferenciaDeObjeto = {
        clave: '../../otro-bucket/secreto',
        bytes: 1,
        sha256: '0'.repeat(64),
        tipoContenido: 'text/plain',
        nombreOriginal: 'x',
      };
      await expect(almacen.descargar(mala)).rejects.toThrow(ClaveInvalidaError);
      await expect(almacen.enlaceDeDescarga(mala)).rejects.toThrow(ClaveInvalidaError);
    });

    it('detecta un objeto alterado en el bucket por su hash', async () => {
      const ref = await almacen.subirEntrega(
        VACANTE,
        ENTREGA,
        'original.txt',
        Buffer.from('respuesta original'),
        'text/plain',
      );
      // Misma clave, contenido distinto en la referencia: equivale a que
      // alguien haya reemplazado el objeto despues de entregarlo.
      const manipulada = { ...ref, sha256: 'f'.repeat(64) };
      await expect(almacen.descargar(manipulada)).rejects.toThrow(ObjetoNoEncontradoError);
    });

    it('una referencia a un objeto inexistente da error controlado, no una traza del SDK', async () => {
      const inexistente: ReferenciaDeObjeto = {
        clave: `entregas/${VACANTE}/${ENTREGA}/${crypto.randomUUID()}.zip`,
        bytes: 1,
        sha256: '0'.repeat(64),
        tipoContenido: 'application/zip',
        nombreOriginal: 'x.zip',
      };
      await expect(almacen.descargar(inexistente)).rejects.toThrow(ObjetoNoEncontradoError);
      await expect(almacen.enlaceDeDescarga(inexistente)).rejects.toThrow(ObjetoNoEncontradoError);
    });
  });
});
