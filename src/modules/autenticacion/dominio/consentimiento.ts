/**
 * Los permisos que el titular de los datos concede o revoca.
 *
 * DE DONDE SALE ESTA LISTA
 *
 * De las dos pantallas que los muestran, no de la cabeza de nadie: B12
 * ("Antes de continuar, decide que autorizas", paso 2 de 3 del registro) y el
 * panel "Privacidad de tus datos" de B24. Los textos de abajo son los de esas
 * pantallas.
 *
 * LAS DOS PANTALLAS NO COINCIDEN, Y ESO NO SE RESUELVE AQUI
 *
 * B12 pide tres permisos: biometria, calificacion por IA y publicacion del
 * perfil. B24 ofrece revocar otros tres: perfil visible, grabaciones
 * biometricas y **datos para el Mentor IA**. O sea:
 *
 * - "Datos para el Mentor IA" se puede revocar en B24 pero **nunca se pidio**.
 *   Tratar datos para una finalidad que el titular no autorizo es justo lo que
 *   la Ley 1581 prohibe, asi que aqui nace en `false` y hace falta pedirlo.
 * - "Calificacion por IA generativa" se pide en B12 y **no aparece** en el
 *   panel de revocacion, aunque la propia B12 promete que "cada permiso es
 *   independiente y puedes revocarlo cuando quieras desde Mi perfil >
 *   Privacidad".
 *
 * Esa segunda era la de verdad incomoda: si se puede revocar, un candidato que
 * lo apague no puede ser evaluado, y evaluar es el producto entero. Se decidio
 * el 28/10 (D-17, contradiccion §6.10 de la matriz): **si es revocable, y
 * revocarlo significa no poder entregar**. El modulo de entregas lo exige antes
 * de aceptar nada, y el candidato recibe un 403 que dice como volver atras.
 *
 * Los otros tres se **registran y no se hacen cumplir**, y el campo `vigilado`
 * lo dice en la respuesta en vez de callarlo: las funciones que gobiernan
 * —proctoring, banco de talento, Mentor IA— no existen todavia en el backend.
 */
export enum TipoDeConsentimiento {
  Biometria = 'biometria',
  CalificacionIA = 'calificacion_ia',
  PerfilPublico = 'perfil_publico',
  MentorIA = 'mentor_ia',
}

export const TIPOS_DE_CONSENTIMIENTO = Object.values(TipoDeConsentimiento);

/** Desde donde se tomo la decision. Sirve para probar como se obtuvo. */
export enum OrigenDelConsentimiento {
  Registro = 'registro',
  Perfil = 'perfil',
}

/**
 * Version del texto que el titular acepto.
 *
 * La Ley 1581 no pide solo un "si": pide poder demostrar **a que** dijo que si.
 * Si manana se reescribe la descripcion de un permiso, las decisiones viejas
 * siguen apuntando a la version que la persona leyo de verdad. Se sube a mano
 * cuando cambie cualquiera de los textos de abajo.
 */
export const VERSION_DEL_AVISO = '2026-10-28';

export interface PermisoDelCatalogo {
  readonly tipo: TipoDeConsentimiento;
  /** Titulo tal como lo muestra la pantalla. */
  readonly titulo: string;
  /** La frase que la pantalla pone debajo del titulo. */
  readonly descripcion: string;
  /** Si la pantalla de registro (B12) lo pregunta. */
  readonly sePideEnElRegistro: boolean;
  /** Con que valor nace si el titular nunca decidio. */
  readonly porOmision: boolean;
  /** Que pasaria al revocarlo. Hoy es documentacion, no comportamiento. */
  readonly efecto: string;
  /**
   * Si algo del backend lo hace cumplir hoy. Solo `calificacion_ia` lo esta;
   * los otros tres estan en `false` porque las funciones que gobiernan
   * —proctoring, banco de talento, Mentor IA— no existen todavia. Va en la
   * respuesta a proposito: una pantalla que promete control sobre algo que
   * nadie vigila es peor que no prometerlo, y quien construya una de esas tres
   * funciones tiene que llamar a `autoriza()` y mover este campo.
   */
  readonly vigilado: boolean;
}

export const CATALOGO: readonly PermisoDelCatalogo[] = [
  {
    tipo: TipoDeConsentimiento.Biometria,
    titulo: 'Grabacion y verificacion biometrica',
    descripcion:
      'Activa tu camara solo durante los retos pagados, para prevenir suplantacion. ' +
      'La grabacion se conserva 90 dias.',
    sePideEnElRegistro: true,
    // B12 lo muestra encendido, con la etiqueta "Requerido para retos con
    // camara". Revocarlo no excluye de ninguna vacante: B16 ofrece la
    // modalidad alterna con verificacion manual.
    porOmision: true,
    efecto: 'Los retos con camara pasan a la modalidad alterna con verificacion manual (B16).',
    vigilado: false,
  },
  {
    tipo: TipoDeConsentimiento.CalificacionIA,
    titulo: 'Calificacion por IA generativa',
    descripcion:
      'Tu entregable se evalua contra la rubrica del reto. Ninguna descalificacion con ' +
      'consecuencia economica ocurre sin revision humana previa.',
    sePideEnElRegistro: true,
    porOmision: true,
    efecto:
      'Dejas de poder entregar retos: sin este permiso tu entregable no se envia a evaluar. ' +
      'Las entregas que ya hiciste no se deshacen.',
    // El unico que el backend hace cumplir hoy: `entregas` lo exige antes de
    // aceptar nada. Decidido el 28/10 (D-17), cerrando la contradiccion §6.10.
    vigilado: true,
  },
  {
    tipo: TipoDeConsentimiento.PerfilPublico,
    titulo: 'Publicacion de tu perfil a otras empresas',
    descripcion:
      'Tu puntaje queda visible en el banco de talento para que otros reclutadores te ' +
      'encuentren, aunque no ganes esta vacante.',
    sePideEnElRegistro: true,
    // El unico que B12 marca "Opcional", y nace apagado en la pantalla.
    porOmision: false,
    efecto: 'El perfil deja de aparecer en el banco de talento.',
    vigilado: false,
  },
  {
    tipo: TipoDeConsentimiento.MentorIA,
    titulo: 'Datos para el Mentor IA',
    descripcion: 'Recomendaciones personalizadas.',
    // Aparece en B24 y NO en B12: nadie lo pide. Nace apagado porque tratar
    // datos para una finalidad no autorizada es lo que la Ley 1581 prohibe.
    sePideEnElRegistro: false,
    porOmision: false,
    efecto: 'El Mentor IA deja de usar el historial de retos para recomendar.',
    vigilado: false,
  },
];

export function permisoDelCatalogo(tipo: TipoDeConsentimiento): PermisoDelCatalogo {
  const permiso = CATALOGO.find((p) => p.tipo === tipo);
  // El enum y el catalogo se escriben juntos; si alguien añade uno y olvida el
  // otro, es mejor romper aqui que servir un permiso sin texto.
  if (!permiso) throw new Error(`Falta el permiso "${tipo}" en el catalogo de consentimientos`);
  return permiso;
}
