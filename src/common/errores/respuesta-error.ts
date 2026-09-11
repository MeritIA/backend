/**
 * Forma unica de las respuestas de error de la API.
 *
 * Paquete 2.4: "ninguna respuesta expone trazas internas ni detalles de la
 * infraestructura al cliente". Este contrato es lo que lo hace cumplir: el
 * cliente siempre recibe estos campos y nada mas.
 *
 * `codigo` es estable y legible por maquina, para que el frontend pueda
 * reaccionar sin interpretar el mensaje. `mensaje` es para la persona.
 * `referencia` permite cruzar una queja de un usuario con la linea del log sin
 * ensenarle nada del interior.
 */
export interface RespuestaError {
  /** Codigo HTTP. */
  readonly estado: number;
  /** Identificador estable del tipo de error, en MAYUSCULAS_CON_GUION_BAJO. */
  readonly codigo: string;
  /** Explicacion para una persona. Nunca incluye detalle de infraestructura. */
  readonly mensaje: string;
  /** Momento del error, en UTC. */
  readonly momento: string;
  /** Ruta que se pidio. */
  readonly ruta: string;
  /** Identificador para cruzar con los logs del servidor. */
  readonly referencia: string;
  /** Detalle de validacion campo a campo. Solo en errores 400 de DTO. */
  readonly errores?: readonly DetalleValidacion[];
}

export interface DetalleValidacion {
  readonly campo: string;
  readonly problemas: readonly string[];
}

export const CODIGOS = {
  VALIDACION: 'VALIDACION_FALLIDA',
  NO_AUTENTICADO: 'NO_AUTENTICADO',
  PROHIBIDO: 'PROHIBIDO',
  NO_ENCONTRADO: 'NO_ENCONTRADO',
  CONFLICTO: 'CONFLICTO',
  LIMITE_EXCEDIDO: 'LIMITE_DE_PETICIONES_EXCEDIDO',
  INTERNO: 'ERROR_INTERNO',
} as const;
