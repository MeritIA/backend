// Interfaz publica del modulo de autenticacion.
// Lo que no se reexporte aqui es interno y ningun otro modulo puede importarlo.
export { AutenticacionModule } from './autenticacion.module.js';
export { AutenticacionService, type Identidad } from './autenticacion.service.js';
export { Rol, PERMISOS, rolTienePermiso, type Permiso } from './dominio/rol.js';
export { Publico, type UsuarioAutenticado } from './guardias/autenticacion.guard.js';
export { Roles, RequierePermiso } from './guardias/roles.guard.js';
export { TipoCliente, COOKIE_ACCESO, COOKIE_RENOVACION } from './dominio/tipo-cliente.js';
export { EmpresasService, type ResumenDeEmpresa } from './empresas.service.js';
export { type SectorEmpresa } from './dominio/sector.js';
export { ConsentimientosService, type EstadoDeUnPermiso } from './consentimientos.service.js';
export {
  TipoDeConsentimiento,
  OrigenDelConsentimiento,
  VERSION_DEL_AVISO,
} from './dominio/consentimiento.js';
export { CUENTA_ELIMINADA, type EventoCuentaEliminada } from './dominio/eventos.js';
