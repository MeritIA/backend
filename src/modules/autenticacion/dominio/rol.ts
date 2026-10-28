/**
 * Roles de MeritIA.
 *
 * Los tres que define el Plan de Seguridad §2 y el planteamiento de
 * arquitectura. No hay mas: un rol nuevo es una decision de producto, no algo
 * que se añada sobre la marcha.
 */
export enum Rol {
  Candidato = 'candidato',
  Reclutador = 'reclutador',
  Administrador = 'administrador',
}

export const ROLES = Object.values(Rol);

/**
 * Matriz de roles y permisos, entregable del paquete 2.1.
 *
 * Se declara aqui en un solo sitio, en lugar de repartir condiciones por los
 * controladores: asi se puede leer de un vistazo quien puede hacer que, y
 * revisarla es mirar una tabla y no rastrear el codigo.
 *
 * ATENCION: esto resuelve unicamente la autorizacion **por rol**. La
 * autorizacion **por recurso** —que un candidato solo vea SU entrega— no puede
 * vivir en una tabla, porque depende del dato concreto. Se comprueba en cada
 * servicio. El encuadre lo dice sin rodeos: un usuario nunca debe poder acceder
 * a un recurso cambiando un identificador en la peticion.
 */
export const PERMISOS = {
  'vacantes:crear': [Rol.Reclutador, Rol.Administrador],
  'vacantes:leer': [Rol.Candidato, Rol.Reclutador, Rol.Administrador],
  'vacantes:editar': [Rol.Reclutador, Rol.Administrador],
  'vacantes:eliminar': [Rol.Administrador],

  'ejercicios:crear': [Rol.Reclutador, Rol.Administrador],
  'ejercicios:leer': [Rol.Reclutador, Rol.Administrador],
  'ejercicios:editar': [Rol.Reclutador, Rol.Administrador],

  'entregas:crear': [Rol.Candidato],
  'entregas:leerPropias': [Rol.Candidato],
  'entregas:leerDeLaVacante': [Rol.Reclutador, Rol.Administrador],

  'evaluaciones:leerPropias': [Rol.Candidato],
  'evaluaciones:leerDeLaVacante': [Rol.Reclutador, Rol.Administrador],
  'evaluaciones:reintentar': [Rol.Administrador],
  'evaluaciones:verCola': [Rol.Administrador],

  'reportes:verDeLaVacante': [Rol.Reclutador, Rol.Administrador],
  // Revelar la identidad de un candidato quita una proteccion de privacidad:
  // es un permiso propio y no un efecto de poder ver el reporte.
  'reportes:revelarIdentidad': [Rol.Reclutador, Rol.Administrador],
  'reportes:verAuditoria': [Rol.Reclutador, Rol.Administrador],

  // Los avisos por correo de una vacante: mirar que salio y reintentar lo que
  // no. Los mismos roles que ven los reportes de la vacante, porque es la misma
  // persona la que cierra el proceso y responde por lo que se comunico.
  'notificaciones:verDeLaVacante': [Rol.Reclutador, Rol.Administrador],
  'notificaciones:reenviar': [Rol.Reclutador, Rol.Administrador],

  'usuarios:administrar': [Rol.Administrador],
  'empresas:administrar': [Rol.Administrador],
} as const satisfies Record<string, readonly Rol[]>;

export type Permiso = keyof typeof PERMISOS;

export function rolTienePermiso(rol: Rol, permiso: Permiso): boolean {
  return (PERMISOS[permiso] as readonly Rol[]).includes(rol);
}
