/**
 * NIT colombiano y su digito de verificacion.
 *
 * POR QUE SE COMPRUEBA EL DIGITO
 *
 * La pantalla A01 verifica la empresa contra la Camara de Comercio. Esa
 * integracion no existe —queda marcada como ampliacion de alcance en
 * `docs/matriz-pantallas.md`— y mientras no exista, el digito de verificacion es
 * la unica comprobacion disponible: es una propiedad aritmetica del numero, asi
 * que detecta el NIT inventado y el digito mal copiado sin preguntarle a nadie.
 * Aceptar un NIT sin el digito seria tirar la unica verificacion que se tiene.
 *
 * No prueba que la empresa exista. Prueba que ese numero puede ser un NIT.
 *
 * EL ALGORITMO
 *
 * Es el de la DIAN: cada digito de la base, leido de derecha a izquierda, se
 * multiplica por un primo de la serie; se suma; se toma el resto de dividir por
 * 11. Si el resto es 0 o 1, el digito es el resto; si no, es 11 menos el resto.
 *
 * Esta verificado contra dos NIT publicos y conocidos, que son los casos de la
 * prueba: 890903938-8 (resto 3, digito 8) y 899999068-1 (resto 1, digito 1).
 * El segundo cubre justo la rama del resto menor que 2, que es donde una
 * implementacion descuidada se equivoca.
 */

/**
 * Primos de la serie de la DIAN, del digito mas a la derecha hacia la
 * izquierda. Quince posiciones: un NIT de empresa tiene nueve digitos de base,
 * pero una persona natural usa su cedula, y la serie oficial llega hasta aqui.
 */
const PRIMOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/** Entre 8 y 15 digitos de base, un guion, y el digito de verificacion. */
const FORMA = /^(\d{8,15})-(\d)$/;

/**
 * Calcula el digito de verificacion de la base de un NIT (la parte sin guion).
 *
 * Devuelve `null` si la base no son entre 8 y 15 digitos: sin base no hay
 * digito, y devolver un numero cualquiera haria pasar por valido algo que no se
 * pudo calcular.
 */
export function digitoDeVerificacion(base: string): number | null {
  if (!/^\d{8,15}$/.test(base)) return null;

  let suma = 0;
  for (let i = 0; i < base.length; i += 1) {
    // De derecha a izquierda: el ultimo digito de la base lleva el primer primo.
    const digito = Number(base[base.length - 1 - i]);
    suma += digito * PRIMOS[i];
  }

  const resto = suma % 11;
  return resto < 2 ? resto : 11 - resto;
}

/**
 * Normaliza como se escribe un NIT en la vida real.
 *
 * En una factura aparece "890.903.938-8", y a veces con espacios. Se quitan los
 * puntos y los espacios y se deja la forma canonica `base-digito`, que es la que
 * se guarda: si la misma empresa se registrara una vez con puntos y otra sin
 * ellos, el indice unico no la reconoceria y quedaria duplicada.
 */
export function normalizarNit(valor: string): string {
  return valor.replace(/[.\s]/g, '');
}

/** `true` solo si tiene la forma `base-digito` y el digito es el que toca. */
export function esNitValido(valor: string): boolean {
  const partes = FORMA.exec(normalizarNit(valor));
  if (!partes) return false;

  const esperado = digitoDeVerificacion(partes[1]);
  return esperado !== null && esperado === Number(partes[2]);
}
