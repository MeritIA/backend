// Interfaz publica de las alertas de seguridad (paquete 5.5).
export { AlertasModule } from './alertas.module.js';
export { AlertasService, REGLAS } from './alertas.service.js';
export { CorreoService } from './correo.js';
export {
  EVENTO_DE_SEGURIDAD,
  type EventoDeSeguridad,
  type TipoDeEventoDeSeguridad,
} from './evento-de-seguridad.js';
