/**
 * El texto de los avisos a candidatos.
 *
 * Es una funcion pura y vive en el dominio por una razon concreta: lo que un
 * correo le dice a una persona real es una decision de producto, y tiene que
 * poder revisarse y probarse sin levantar la aplicacion ni tocar SMTP.
 *
 * QUE DICE Y QUE NO DICE EL AVISO DE CIERRE
 *
 * Decidido el 27/10/2026 (D-10 de la Declaracion de Alcance):
 *
 * - NO lleva la nota, ni el puesto, ni el desglose de la rubrica. El resultado
 *   se mira en la plataforma, autenticado. El correo viaja por servidores
 *   ajenos, se reenvia y se queda en bandejas durante anos; un "57 sobre 100"
 *   suelto en un buzon es un juicio sobre una persona sin la rubrica que lo
 *   explica. La minimizacion de datos de la Ley 1581 apunta al mismo lado.
 * - NO dice si fue seleccionada o descartada. El cierre de la vacante no es una
 *   decision de contratacion, y comunicar un rechazo es una decision de la
 *   empresa, no de un trabajo automatico.
 * - NO menciona a nadie mas: ni cuantos participaron, ni quien quedo arriba. El
 *   anonimato del proceso se cae por el canal mas tonto si el correo lo cuenta.
 * - SI dice el titulo de la vacante: quien se presento a tres procesos no sabe
 *   de cual le hablan sin eso.
 */

/** Lo que hace falta para redactar el aviso de cierre. */
export interface DatosDelCierre {
  readonly nombre: string;
  readonly tituloVacante: string;
  /** Donde entra el candidato a ver su resultado. Si no hay, el aviso no la inventa. */
  readonly urlPlataforma?: string;
}

export interface TextoDelAviso {
  readonly asunto: string;
  readonly cuerpo: string;
}

/** Largo maximo del titulo dentro del asunto: un asunto de 400 caracteres se corta solo. */
const LARGO_DEL_TITULO = 120;

/**
 * Quita saltos de linea y retornos de carro.
 *
 * NO es cosmetica: el titulo de la vacante lo escribe un reclutador y acaba en
 * la cabecera Subject del correo. Un salto de linea ahi permite inyectar
 * cabeceras SMTP —un Bcc, por ejemplo— y convertir un aviso de cierre en un
 * envio a terceros. Se limpia aqui, en el dominio, y no se confia en que la
 * libreria de correo lo haga.
 */
function enUnaLinea(texto: string): string {
  return texto.replace(/[\r\n]+/g, ' ').trim();
}

function recortar(texto: string, largo: number): string {
  return texto.length <= largo ? texto : `${texto.slice(0, largo - 1).trimEnd()}…`;
}

export function avisoDeCierre(datos: DatosDelCierre): TextoDelAviso {
  const titulo = recortar(enUnaLinea(datos.tituloVacante), LARGO_DEL_TITULO);
  const nombre = enUnaLinea(datos.nombre);
  const url = datos.urlPlataforma ? enUnaLinea(datos.urlPlataforma) : undefined;

  const lineas = [
    `Hola, ${nombre}:`,
    '',
    `El proceso de seleccion de la vacante "${titulo}" se cerro. Gracias por el`,
    'tiempo que le dedicaste a la prueba.',
    '',
    'Tu resultado ya esta disponible en MeritIA: al entrar con tu cuenta puedes ver',
    'tu calificacion, el desglose por cada criterio de la rubrica y el puesto que',
    'ocupaste en el proceso.',
  ];

  if (url) lineas.push('', url);

  lineas.push(
    '',
    'Este es un aviso automatico y no contiene informacion de otros participantes.',
    'Si no reconoces este proceso, puedes ignorar este correo.',
    '',
    '--',
    'MeritIA',
  );

  return {
    asunto: `Se cerro el proceso de "${titulo}"`,
    cuerpo: lineas.join('\n'),
  };
}
