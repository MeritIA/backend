import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  EntregaIlegibleError,
  MAX_ARCHIVOS,
  MAX_BYTES_POR_ARCHIVO,
  extraerTexto,
  type MotivoIlegible,
} from './extraer-texto.js';

/**
 * Construye un .zip en memoria, sin dependencias de prueba.
 *
 * El CRC va calculado de verdad: yauzl lo comprueba al leer, y un zip sin CRC
 * pareceria corrupto en vez de ejercitar lo que se quiere probar.
 */
function zipCon(archivos: { ruta: string; contenido: Buffer | string }[]): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let desplazamiento = 0;

  for (const archivo of archivos) {
    const nombre = Buffer.from(archivo.ruta, 'utf8');
    const datos = Buffer.isBuffer(archivo.contenido)
      ? archivo.contenido
      : Buffer.from(archivo.contenido, 'utf8');
    const comprimido = deflateRawSync(datos);
    const suma = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(suma, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombre);

    desplazamiento += local.length + nombre.length + comprimido.length;
  }

  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(cuerpo.length, 16);

  return Buffer.concat([cuerpo, directorio, fin]);
}

async function motivoDe(contenido: Buffer, nombre: string): Promise<MotivoIlegible | 'no-lanzo'> {
  try {
    await extraerTexto(contenido, nombre);
    return 'no-lanzo';
  } catch (e) {
    return e instanceof EntregaIlegibleError ? e.motivo : 'no-lanzo';
  }
}

describe('extraccion de texto de una entrega', () => {
  it('lee un archivo de texto suelto', async () => {
    const r = await extraerTexto(Buffer.from('select 1;'), 'consulta.sql');
    expect(r).toEqual([{ ruta: 'consulta.sql', contenido: 'select 1;' }]);
  });

  it('lee los archivos de texto de un .zip y descarta lo demas', async () => {
    const zip = zipCon([
      { ruta: 'src/main.py', contenido: 'def invertir(l):\n    return l[::-1]\n' },
      { ruta: 'README.md', contenido: '# Solucion' },
      { ruta: 'logo.png', contenido: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { ruta: 'carpeta/', contenido: '' },
    ]);

    const r = await extraerTexto(zip, 'entrega.zip');

    expect(r.map((a) => a.ruta).sort()).toEqual(['README.md', 'src/main.py']);
    expect(r.find((a) => a.ruta === 'src/main.py')?.contenido).toContain('def invertir');
  });

  describe('defensas', () => {
    it('BOMBA: un archivo enorme se descarta y el resto de la entrega se conserva', async () => {
      const enorme = 'a'.repeat(MAX_BYTES_POR_ARCHIVO + 50_000);
      const zip = zipCon([
        { ruta: 'bomba.txt', contenido: enorme },
        { ruta: 'bueno.txt', contenido: 'contenido legitimo' },
      ]);

      const r = await extraerTexto(zip, 'entrega.zip');

      expect(r.map((a) => a.ruta)).toEqual(['bueno.txt']);
    });

    it('BOMBA: se rechaza cuando el total descomprimido se dispara', async () => {
      const relleno = 'a'.repeat(MAX_BYTES_POR_ARCHIVO - 1);
      const muchos = Array.from({ length: 6 }, (_, i) => ({
        ruta: `archivo-${i}.txt`,
        contenido: relleno,
      }));

      expect(await motivoDe(zipCon(muchos), 'entrega.zip')).toBe('demasiado_grande');
    });

    it('ZIP SLIP: un zip con rutas de escape se rechaza entero', async () => {
      // yauzl valida los nombres y rechaza el archivo completo en cuanto
      // aparece una ruta con `..` o absoluta, antes de que llegue a nuestro
      // filtro. Falla cerrado, que es lo que se quiere: ante una entrega que
      // intenta escapar del directorio, no se evalua nada de ella.
      for (const ruta of ['../../etc/passwd.txt', '/etc/sombra.txt']) {
        const zip = zipCon([
          { ruta, contenido: 'root:x:0:0' },
          { ruta: 'ok.txt', contenido: 'contenido legitimo' },
        ]);
        expect(await motivoDe(zip, 'entrega.zip')).toBe('comprimido_invalido');
      }
    });

    it('una ruta con barras invertidas tampoco pasa', async () => {
      const zip = zipCon([{ ruta: 'carpeta\\..\\..\\fuera.txt', contenido: 'contenido' }]);
      expect(await motivoDe(zip, 'entrega.zip')).toBe('comprimido_invalido');
    });

    it('un binario disfrazado de texto se descarta', async () => {
      const binario = Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03]);
      expect(await motivoDe(binario, 'trampa.txt')).toBe('sin_archivos_legibles');

      const zip = zipCon([
        { ruta: 'trampa.txt', contenido: binario },
        { ruta: 'real.txt', contenido: 'texto de verdad' },
      ]);
      expect((await extraerTexto(zip, 'e.zip')).map((a) => a.ruta)).toEqual(['real.txt']);
    });

    it('demasiados archivos de texto se rechazan', async () => {
      const muchos = Array.from({ length: MAX_ARCHIVOS + 5 }, (_, i) => ({
        ruta: `a-${i}.txt`,
        contenido: 'x',
      }));
      expect(await motivoDe(zipCon(muchos), 'entrega.zip')).toBe('demasiado_grande');
    });
  });

  describe('respuesta cuando la entrega no se puede leer', () => {
    it('un .zip corrupto se rechaza sin reventar', async () => {
      expect(await motivoDe(Buffer.from('esto no es un zip'), 'entrega.zip')).toBe(
        'comprimido_invalido',
      );
    });

    it('un .zip sin archivos de texto lo dice', async () => {
      const zip = zipCon([{ ruta: 'foto.png', contenido: Buffer.from([0x89, 0x50]) }]);
      expect(await motivoDe(zip, 'entrega.zip')).toBe('sin_archivos_legibles');
    });

    it('los formatos que aun no se leen dan un mensaje que explica que hacer', async () => {
      for (const nombre of ['informe.pdf', 'codigo.tar', 'codigo.tgz', 'datos.gz']) {
        expect(await motivoDe(Buffer.from('cualquier cosa'), nombre)).toBe('formato_no_soportado');
      }

      let mensaje = '';
      try {
        await extraerTexto(Buffer.from('%PDF-1.4'), 'informe.pdf');
      } catch (e) {
        mensaje = (e as Error).message;
      }
      expect(mensaje).toMatch(/\.zip o un archivo de texto/);
    });
  });
});
