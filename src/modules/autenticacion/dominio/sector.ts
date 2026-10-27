/**
 * Sector economico de una empresa cliente.
 *
 * POR QUE UNA LISTA CERRADA Y NO TEXTO LIBRE
 *
 * La pregunta que este campo existe para responder es "cuantas convocatorias al
 * ano tiene una empresa del sector financiero". Con texto libre esa consulta no
 * se puede agrupar: "Financiero", "finanzas", "banca" y "Banca y seguros"
 * serian cuatro sectores distintos, y el informe saldria vacio justo cuando se
 * necesita. Una lista cerrada se puede agrupar, contar y comparar.
 *
 * POR QUE ESTA LISTA Y NO LA CIIU
 *
 * La clasificacion oficial colombiana es la CIIU del DANE, y tiene mas de
 * quinientas clases. Nadie la elige en un formulario de registro, y un dato que
 * se llena mal no sirve para agrupar. Estas catorce entradas son el nivel al que
 * una empresa se reconoce de un vistazo.
 *
 * LA LISTA NO ESTA RATIFICADA. Ningun documento del proyecto define una
 * taxonomia de sectores: sale del campo "sector" de la pantalla A01 y de lo que
 * el profesor pidio poder responder. Queda anotada en la Declaracion de Alcance
 * para que el equipo la cambie. Anadir un sector es un `ALTER TYPE ... ADD
 * VALUE` y nada mas; quitar uno obliga a reclasificar las empresas que lo usan,
 * asi que conviene que sobre antes que falte.
 */
export enum SectorEmpresa {
  Financiero = 'financiero',
  Tecnologia = 'tecnologia',
  Salud = 'salud',
  Educacion = 'educacion',
  Industria = 'industria',
  Comercio = 'comercio',
  Servicios = 'servicios',
  Construccion = 'construccion',
  Agro = 'agro',
  Transporte = 'transporte',
  Energia = 'energia',
  Telecomunicaciones = 'telecomunicaciones',
  Gobierno = 'gobierno',
  /**
   * Salida de emergencia, y el valor por omision en la base.
   *
   * Existe por dos razones: las filas que son anteriores a esta columna tienen
   * que valer algo, y una empresa que no se reconoce en la lista no puede
   * quedarse sin registrarse. En un informe por sector, "otro" que crece es la
   * senal de que a la lista le falta una entrada.
   */
  Otro = 'otro',
}

/** Los valores, para validar en el DTO y para documentar el contrato. */
export const SECTORES: readonly SectorEmpresa[] = Object.values(SectorEmpresa);
