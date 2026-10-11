// Interfaz publica del modulo de reportes.
// Lo que no se reexporte aqui es interno y ningun otro modulo puede importarlo.
export { ReportesModule } from './reportes.module.js';
export {
  ReportesService,
  type ReporteDeVacante,
  type ReporteDeCandidato,
  type FilaConCandidato,
} from './reportes.service.js';
