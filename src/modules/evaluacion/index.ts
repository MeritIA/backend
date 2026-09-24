// Interfaz publica del modulo de evaluacion.
// Lo que no se reexporte aqui es interno y ningun otro modulo puede importarlo.
export { EvaluacionModule } from './evaluacion.module.js';
export { EvaluacionService } from './evaluacion.service.js';
export {
  ColaDeEvaluacionService,
  type DatosDelTrabajo,
  type MetricasDeCola,
} from './cola/cola-de-evaluacion.service.js';
export {
  EVALUADOR,
  EvaluacionNoReintentableError,
  ServicioDeIaNoDisponibleError,
  type Evaluador,
  type TrabajoDeEvaluacion,
} from './cola/evaluador.js';
export { NOMBRE_COLA_EVALUACION } from './cola/politica-de-cola.js';
