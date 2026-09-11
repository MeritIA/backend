// Interfaz publica del modulo de autenticacion.
// Lo que no se reexporte aqui es interno y ningun otro modulo puede importarlo.
export { AutenticacionModule } from './autenticacion.module.js';
export { AutenticacionService } from './autenticacion.service.js';
export { Rol, PERMISOS, rolTienePermiso, type Permiso } from './dominio/rol.js';
export { Publico, type UsuarioAutenticado } from './guardias/autenticacion.guard.js';
export { Roles, RequierePermiso } from './guardias/roles.guard.js';
