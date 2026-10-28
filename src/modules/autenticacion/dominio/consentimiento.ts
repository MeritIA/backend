/**
 * Los permisos que el titular de los datos concede o revoca.
 *
 * DE DONDE SALE ESTA LISTA, Y POR QUE ES ESTA Y NO OTRA
 *
 * Del **Taller 2 · BPM y Wireframes**, que es donde el propio equipo audito su
 * proceso. Entre los defectos que encontro en el BPM:
 *
 *   "El consentimiento inicial se asume suficiente para cubrir todo el ciclo
 *    del dato: grabacion biometrica, calificacion por IA y exposicion
 *    posterior del perfil 'visible para otras empresas' en el banco de
 *    talento. No se modela un consentimiento diferenciado por cada uso
 *    posterior del dato."
 *
 * Y el cambio que decidio:
 *
 *   "Separar el consentimiento unico en pasos diferenciados por finalidad
 *    (grabacion/biometria, calificacion por IA, publicacion del perfil a
 *    terceros en el banco de talento), cada uno revocable de forma
 *    independiente por el candidato."
 *
 * TRES finalidades, nombradas. Son exactamente las tres tarjetas de la
 * pantalla B12, en ese orden: B12 no es un mockup mas, es la implementacion de
 * esa correccion. Por eso esta lista manda sobre cualquier otra (D-18).
 *
 * QUE PASO CON "DATOS PARA EL MENTOR IA"
 *
 * Aparece en el panel de B24 y en ningun documento mas: ni en el Taller 2, ni
 * en la EDT, ni en el Charter, ni en el Plan de Seguridad. El Modelo de
 * Negocio dice ademas que el mentor arranca "con datos publicos de mercado
 * laboral", o sea sin tratar datos del candidato para una finalidad nueva.
 * No es una finalidad documentada hoy, asi que no se pide: pedir un permiso
 * que nadie necesita entrena a la gente a decir que si sin leer.
 *
 * Cuando el mentor pase a usar "datos propios de contratacion" —que es lo que
 * el mismo Modelo de Negocio planea— volvera a ser una finalidad, habra que
 * anadirlo aqui y B12 tendra que preguntarlo.
 */
/**
 * Todo lo que la tabla de consentimientos PUEDE contener, historia incluida.
 *
 * No es lo mismo que el catalogo: una finalidad que se dejo de ofrecer sigue
 * teniendo filas, y un registro de consentimientos que no puede leer su propio
 * pasado no sirve para lo que existe. `mentor_ia` esta aqui por eso y no
 * aparece en `CATALOGO`.
 */
export enum TipoDeConsentimiento {
  Biometria = 'biometria',
  CalificacionIA = 'calificacion_ia',
  PerfilPublico = 'perfil_publico',
  MentorIA = 'mentor_ia',
}

/** Todo lo que la tabla puede guardar, retiradas incluidas. */
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

/**
 * Las finalidades que HOY se piden. Tres, las del Taller 2.
 *
 * Es deliberadamente mas corto que `TipoDeConsentimiento`: lo que se ofrece
 * cambia con el producto, lo que la tabla guarda no se puede encoger.
 */
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
];

/**
 * Las finalidades que se pueden enviar hoy. Es lo que el contrato publica.
 *
 * Se deriva del catalogo en vez de escribirse aparte: dos listas que hay que
 * acordarse de mover juntas acaban siendo una lista y un error.
 */
export const TIPOS_OFRECIDOS = CATALOGO.map((p) => p.tipo);

/** Si esta finalidad se puede decidir hoy. Una retirada se lee, no se escribe. */
export function seOfrece(tipo: TipoDeConsentimiento): boolean {
  return CATALOGO.some((p) => p.tipo === tipo);
}

export function permisoDelCatalogo(tipo: TipoDeConsentimiento): PermisoDelCatalogo {
  const permiso = CATALOGO.find((p) => p.tipo === tipo);
  // El enum y el catalogo se escriben juntos; si alguien añade uno y olvida el
  // otro, es mejor romper aqui que servir un permiso sin texto.
  if (!permiso) throw new Error(`Falta el permiso "${tipo}" en el catalogo de consentimientos`);
  return permiso;
}
