/**
 * La afinidad, vista desde `vacantes`.
 *
 * POR QUE ESTE PUERTO EXISTE
 *
 * La invitacion automatica decide al postularse, y postularse pasa en
 * `vacantes`. Pero la afinidad se calcula en `reportes`, porque necesita datos
 * de `evaluacion`, y `evaluacion` ya depende de `vacantes`: pedirsela
 * directamente seria un ciclo entre modulos.
 *
 * Asi que `vacantes` declara QUE necesita --un porcentaje-- y `reportes`, que
 * esta por encima de los dos, se registra al arrancar. Es la misma direccion de
 * dependencia que ya tiene el proyecto, solo que la llamada va al reves.
 *
 * POR QUE NO POR EL BUS DE EVENTOS, QUE ERA LO OBVIO
 *
 * Se intento pensar asi primero. Dos razones lo descartan, y las dos estan en
 * el comentario del propio bus:
 *
 * 1. **Es asincrono.** El candidato recibiria `en_revision` y la invitacion
 *    llegaria despues, asi que su pantalla diria "esperando" cuando ya esta
 *    dentro. Lo sincrono es lo honesto: la respuesta del POST dice el estado
 *    final.
 * 2. **Un suscriptor que falla se registra y ahi queda.** Si la invitacion
 *    automatica fallara, nadie se enteraria y el candidato esperaria para
 *    siempre una decision que no va a llegar. Un fallo que nadie ve es peor que
 *    un fallo que corta la peticion.
 *
 * SI NADIE SE REGISTRA, LA FUNCION NO SE PUEDE ENCENDER
 *
 * `vacantes` no inventa un porcentaje por su cuenta ni se lo salta: activar la
 * invitacion automatica sin calculador devuelve 400 diciendolo. Falla fuerte y
 * pronto, en vez de invitar a todo el mundo en silencio.
 */
export interface CalculadorDeAfinidad {
  /**
   * El % de afinidad de un candidato con una vacante, o `null` si no hay
   * evidencia sobre lo que esa vacante pide.
   *
   * `null` NO es cero: es "no se sabe". Quien lo consuma tiene que decidir que
   * hace con eso, y la invitacion automatica lo trata como "que lo vea una
   * persona", nunca como un rechazo.
   */
  porcentajeDe(idCandidato: string, idVacante: string): Promise<number | null>;
}
