// Interfaz publica del modulo de ejercicios.
// Lo que no se reexporte aqui es interno y ningun otro modulo puede importarlo.
export { EjerciciosModule } from './ejercicios.module.js';
export { EjerciciosService, type ResumenVersion } from './ejercicios.service.js';
export {
  PESO_TOTAL,
  RubricaInvalidaError,
  calcularNotaPonderada,
  validarRubrica,
  type CriterioEntrada,
} from './dominio/rubrica.js';
