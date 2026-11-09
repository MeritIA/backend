/**
 * Como se trabaja en la vacante. Lo muestra y filtra la pantalla «explorar».
 *
 * Sin tilde a proposito: es un valor de contrato y de base de datos, no un
 * texto para leer. La pantalla pone la tilde al mostrarlo.
 */
export enum Modalidad {
  Remoto = 'remoto',
  Hibrido = 'hibrido',
  Presencial = 'presencial',
}

export const MODALIDADES: readonly Modalidad[] = Object.values(Modalidad);

export const MAXIMO_DE_TECNOLOGIAS = 10;
export const LONGITUD_MAXIMA_DE_TECNOLOGIA = 40;
