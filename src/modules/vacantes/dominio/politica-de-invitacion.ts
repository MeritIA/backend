/**
 * La politica de invitacion automatica de una vacante (A04).
 *
 * A04 promete que "MeritIA preselecciona por perfil de habilidades e invita
 * solo a los finalistas". Esto es esa promesa, con tres reglas que la hacen
 * defendible en vez de peligrosa.
 *
 * REGLA 1: SOLO DICE SI, NUNCA NO
 *
 * Es la regla que lo hace seguro, y si se quita hay que rehacer este analisis
 * entero. La automatizacion unicamente **acepta**: a quien no alcanza el umbral
 * lo deja `en_revision`, exactamente donde estaria si la funcion no existiera,
 * esperando a una persona. Asi la funcion no puede perjudicar a nadie: solo
 * puede adelantar.
 *
 * Un rechazo automatico seria otra cosa. Significaria que un algoritmo cierra
 * la puerta sin que nadie mire, y ademas el producto exige un motivo escrito
 * para rechazar --el que el candidato lee-- que una maquina no puede escribir
 * con honestidad.
 *
 * REGLA 2: SIN EVIDENCIA NO SE DECIDE, Y ESO SALVA AL QUE EMPIEZA
 *
 * Si la afinidad es `null` --el candidato no ha hecho ninguna prueba que toque
 * lo que esta vacante pide-- la automatizacion se abstiene. Lo contrario seria
 * la trampa del principiante: sin perfil no entras, sin entrar no haces
 * pruebas, sin pruebas no tienes perfil. Un bucle cerrado que excluiria para
 * siempre a quien llega nuevo, que es justo a quien el producto dice servir.
 *
 * Y para quien quiera abrir del todo, existe el modo sin umbral: ver abajo.
 *
 * REGLA 3: EL CUPO LIMITA LO AUTOMATICO, NO LAS INVITACIONES
 *
 * `cupo` cuenta solo las invitaciones que emitio la maquina. El reclutador
 * sigue pudiendo invitar a mano a quien quiera, sin tope. Esto respeta la
 * decision D-12: `finalistasAEvaluar` es un PLAN y no un maximo, y meter aqui
 * un tope global la contradiria.
 */
import { EstadoVacante } from './estado-vacante.js';

export interface PoliticaDeInvitacion {
  readonly activa: boolean;
  /**
   * Minimo de afinidad para entrar sola, 0 a 100.
   *
   * `null` con la politica activa significa **aceptar a todo el que se
   * postule** (hasta el cupo): el reto pasa a ser el unico filtro, que es la
   * tesis del producto y lo que el ADR-0015 recomendaba. Es el modo que no
   * tiene trampa del principiante, porque no mira el perfil.
   */
  readonly umbral: number | null;
  /** Tope de invitaciones automaticas, o `null` para sin tope. */
  readonly cupo: number | null;
}

/** Lo que la automatizacion decidio, y por que. Es lo que se registra. */
export type DecisionAutomatica =
  | { readonly acepta: true; readonly afinidad: number | null }
  | { readonly acepta: false; readonly motivo: MotivoDeNoAceptar };

export type MotivoDeNoAceptar =
  'politica_apagada' | 'vacante_no_publicada' | 'sin_evidencia' | 'bajo_el_umbral' | 'cupo_agotado';

/**
 * Decide si una postulacion entra sola. Puro: ni base de datos ni red.
 *
 * `afinidad` es el porcentaje ya calculado, o `null` si no hay evidencia.
 * `automaticasEmitidas` es cuantas ha emitido ya esta vacante.
 */
export function decidirInvitacionAutomatica(
  politica: PoliticaDeInvitacion,
  estado: EstadoVacante,
  afinidad: number | null,
  automaticasEmitidas: number,
): DecisionAutomatica {
  if (!politica.activa) return { acepta: false, motivo: 'politica_apagada' };

  // Una vacante que no esta publicada no recibe postulaciones, pero si la
  // politica se aplica en lote a lo pendiente, puede haberse cerrado entre
  // medias. Aceptar entonces daria un reto que no se va a evaluar.
  if (estado !== EstadoVacante.Publicada) {
    return { acepta: false, motivo: 'vacante_no_publicada' };
  }

  if (politica.cupo !== null && automaticasEmitidas >= politica.cupo) {
    return { acepta: false, motivo: 'cupo_agotado' };
  }

  // Sin umbral: abierto. No se mira el perfil, asi que `null` tambien entra y
  // la trampa del principiante no existe en este modo.
  if (politica.umbral === null) return { acepta: true, afinidad };

  // Con umbral: hace falta evidencia. Abstenerse y no rechazar.
  if (afinidad === null) return { acepta: false, motivo: 'sin_evidencia' };
  if (afinidad < politica.umbral) return { acepta: false, motivo: 'bajo_el_umbral' };

  return { acepta: true, afinidad };
}
