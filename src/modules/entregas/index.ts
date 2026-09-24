// Interfaz publica del modulo de entregas.
// Lo que no se reexporte aqui es interno y ningun otro modulo puede importarlo.
export { EntregasModule } from './entregas.module.js';
export {
  EntregasService,
  TransicionInvalidaError,
  type DatosParaEvaluacion,
} from './entregas.service.js';
export { EstadoEntrega } from './dominio/estado-entrega.js';
export { ENTREGA_COMPLETADA, type EventoEntregaCompletada } from './dominio/eventos.js';
