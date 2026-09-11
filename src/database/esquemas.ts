/**
 * Un esquema de PostgreSQL por modulo, no un `public` compartido.
 *
 * El planteamiento de arquitectura lo pide asi para tener aislamiento logico
 * real desde el principio: evita choques de nombres entre tablas y permite que
 * las migraciones de cada modulo avancen por separado. Tambien deja preparado
 * el dia en que un modulo tenga que salir del monolito.
 */
export const ESQUEMAS = [
  'autenticacion',
  'vacantes',
  'ejercicios',
  'entregas',
  'evaluacion',
  'reportes',
] as const;

export type Esquema = (typeof ESQUEMAS)[number];
