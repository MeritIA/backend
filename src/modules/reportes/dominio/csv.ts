/**
 * Exportacion basica del reporte (entregable del paquete 5.1).
 *
 * CSV y no XLSX a proposito: el entregable dice "exportacion basica", el CSV lo
 * abre cualquier hoja de calculo y no mete una dependencia nueva para generar
 * un binario.
 *
 * LA PARTE QUE NO ES OBVIA: INYECCION DE FORMULAS
 *
 * Una celda que empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro no
 * es texto para Excel, LibreOffice o Sheets: es una formula, y se ejecuta al
 * abrir el archivo. Hay formulas que leen otras celdas y las mandan a una URL
 * (`=HYPERLINK`, `=WEBSERVICE`, `=IMPORTDATA`), o que lanzan un ejecutable
 * mediante DDE.
 *
 * En este reporte el riesgo es real y no teorico: la evidencia la escribe un
 * modelo a partir de los archivos que subio el candidato, asi que su contenido
 * viene, en ultima instancia, de un tercero. El candidato que logre que la
 * evidencia empiece por `=` consigue que algo se ejecute en la maquina del
 * reclutador que abre el reporte. Es el mismo atacante del que ya se defiende
 * el paquete 4.2, por otra puerta.
 *
 * Se neutraliza anteponiendo un apostrofo, que es lo que recomienda OWASP: la
 * hoja lo trata como texto y no lo muestra en la celda.
 */

const PELIGROSOS = ['=', '+', '-', '@', '\t', '\r'];

export function neutralizarFormula(valor: string): string {
  return PELIGROSOS.some((p) => valor.startsWith(p)) ? `'${valor}` : valor;
}

/**
 * Lo que puede ser una celda.
 *
 * Deliberadamente NO es `unknown`: un objeto se convertiria en
 * "[object Object]" y el reporte saldria con basura en una columna sin que
 * nadie se enterara. Si manana hace falta exportar algo compuesto, hay que
 * decidir aqui como se escribe.
 */
export type ValorDeCelda = string | number | boolean | Date | null | undefined;

/**
 * Una celda, con las dos reglas del RFC 4180: las comillas se duplican, y se
 * entrecomilla todo lo que lleve coma, comillas o salto de linea.
 */
export function celda(valor: ValorDeCelda): string {
  if (valor === null || valor === undefined) return '';
  const texto = valor instanceof Date ? valor.toISOString() : String(valor);
  const seguro = neutralizarFormula(texto);
  return /[",\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export interface Columna<T> {
  titulo: string;
  valor: (fila: T) => ValorDeCelda;
}

/**
 * El BOM va delante porque Excel en Windows, sin el, lee un CSV como ANSI y
 * destroza cualquier acento. El equipo trabaja en espanol: sin BOM, el primer
 * reporte que abra el cliente piloto sale con la evidencia ilegible.
 */
export const BOM = '﻿';

export function aCsv<T>(filas: readonly T[], columnas: readonly Columna<T>[]): string {
  const lineas = [
    columnas.map((c) => celda(c.titulo)).join(','),
    ...filas.map((f) => columnas.map((c) => celda(c.valor(f))).join(',')),
  ];
  // CRLF: es lo que pide el RFC 4180 y lo que esperan las hojas de calculo en
  // Windows.
  return BOM + lineas.join('\r\n') + '\r\n';
}
