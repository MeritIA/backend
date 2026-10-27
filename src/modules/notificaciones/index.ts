// Interfaz publica del modulo de notificaciones.
// Lo que no se reexporte aqui es interno y ningun otro modulo puede importarlo.
export { NotificacionesModule } from './notificaciones.module.js';
export {
  NotificacionesService,
  type ResumenDeAvisos,
  type EstadoDeUnAviso,
} from './notificaciones.service.js';
export { EstadoDeAviso, TipoDeAviso } from './dominio/estado-aviso.js';
