// Interfaz publica del modulo de vacantes.
// Lo que no se reexporte aqui es interno y ningun otro modulo puede importarlo.
export { VacantesModule } from './vacantes.module.js';
export {
  VacantesService,
  type Solicitante,
  type DatosParaNotificar,
  type VacanteAbierta,
  type OfertaDelCatalogo,
} from './vacantes.service.js';
export { EstadoVacante } from './dominio/estado-vacante.js';
export { VACANTE_CERRADA, type EventoVacanteCerrada } from './dominio/eventos.js';
