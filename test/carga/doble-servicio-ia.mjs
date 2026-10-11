/**
 * Doble del servicio de IA para las pruebas de carga (seccion 11 del encuadre).
 *
 *   node test/carga/doble-servicio-ia.mjs
 *
 * POR QUE EXISTE
 *
 * El escenario obligatorio de "evaluaciones concurrentes" invoca al servicio de
 * IA. Correr un soak sostenido contra Gemini cuesta dinero y choca con el rate
 * limit del proveedor, asi que la propia seccion 11 pide un doble con latencia
 * simulada y reservar el modelo real para un subconjunto acotado. Ese
 * subconjunto ya existe aparte: la calibracion del paquete 4.3.
 *
 * Habla el contrato REAL, el que valida `cliente-servicio-ia.ts`: devuelve el
 * mismo idEvaluacion, una nota entre 0 y 100, un criterio por cada uno de la
 * rubrica recibida con su puntaje dentro de escala y evidencia no vacia, y el
 * bloque de seguridad del paquete 4.2. Si el doble mintiera en la forma, el
 * backend lo rechazaria y mediriamos el camino de error en vez del normal.
 *
 * LO QUE NO SIMULA, Y HAY QUE TENERLO PRESENTE AL LEER LAS CIFRAS
 *
 * El consumo de CPU y memoria del modelo de verdad. Lo que mide la carga con
 * este doble es el backend: la cola, la base de datos, el almacenamiento y el
 * proceso de Node. La latencia del proveedor se simula; su coste de computo, no.
 *
 * Variables:
 *   PUERTO_DOBLE_IA     puerto de escucha (13100)
 *   DOBLE_IA_LATENCIA_MS   latencia base (1500)
 *   DOBLE_IA_JITTER_MS     variacion aleatoria sumada a la base (500)
 *   DOBLE_IA_FALLOS_PCT    porcentaje de respuestas 503, para el escenario de
 *                          degradacion del proveedor (0)
 *   CLAVE_DE_ACCESO        la que exige en Authorization; si falta, no exige
 */
import { createServer } from 'node:http';

const PUERTO = Number(process.env.PUERTO_DOBLE_IA ?? 13100);
const LATENCIA_MS = Number(process.env.DOBLE_IA_LATENCIA_MS ?? 1500);
const JITTER_MS = Number(process.env.DOBLE_IA_JITTER_MS ?? 500);
const FALLOS_PCT = Number(process.env.DOBLE_IA_FALLOS_PCT ?? 0);
const CLAVE = process.env.CLAVE_DE_ACCESO ?? '';

let atendidas = 0;
let fallidas = 0;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function responder(res, estado, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(estado, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

/**
 * Calificacion determinista a partir del tamano del texto recibido.
 *
 * Determinista y no aleatoria a proposito: con notas al azar, dos corridas de
 * la misma carga darian distribuciones distintas y no se podrian comparar.
 */
function calificar(peticion) {
  const bytes = (peticion.archivos ?? []).reduce((s, a) => s + (a.contenido?.length ?? 0), 0);
  const criterios = (peticion.criterios ?? []).map((c, i) => {
    const fraccion = ((bytes + i * 7) % (c.escalaMaxima * 10 + 1)) / 10;
    return {
      criterio: c.nombre,
      puntaje: Math.min(c.escalaMaxima, Math.round(fraccion * 10) / 10),
      evidencia: `Doble de carga: ${bytes} bytes recibidos para "${c.nombre}".`,
    };
  });

  const nota = criterios.reduce((s, c, i) => {
    const escala = peticion.criterios[i].escalaMaxima;
    const peso = peticion.criterios[i].peso;
    return s + (peso * c.puntaje) / escala;
  }, 0);

  return {
    idEvaluacion: peticion.idEvaluacion,
    notaFinal: Math.min(100, Math.round(nota * 100) / 100),
    criterios,
    proveedor: 'doble-de-carga',
    modelo: 'doble-1',
    seguridad: {
      riesgo: 'ninguno',
      puntaje: 0,
      banderas: [],
      versionReglas: 'doble',
      versionListaNegra: 'doble',
    },
  };
}

const servidor = createServer((req, res) => {
  // Señal de vida, que es la que consulta el health check del backend.
  if (req.method === 'GET' && req.url === '/api/salud') {
    return responder(res, 200, { estado: 'vivo', atendidas, fallidas });
  }

  if (req.method !== 'POST' || !req.url.startsWith('/api/v1/evaluaciones')) {
    return responder(res, 404, { mensaje: 'No existe' });
  }

  if (CLAVE && req.headers.authorization !== `Bearer ${CLAVE}`) {
    return responder(res, 401, { mensaje: 'Clave invalida' });
  }

  let cuerpo = '';
  req.on('data', (trozo) => {
    cuerpo += trozo;
    // Tope defensivo: el doble no es el sitio para descubrir que algo manda
    // cien megas, pero tampoco para morir por ello.
    if (cuerpo.length > 20_000_000) {
      req.destroy();
    }
  });

  req.on('end', async () => {
    await dormir(LATENCIA_MS + Math.random() * JITTER_MS);

    if (FALLOS_PCT > 0 && Math.random() * 100 < FALLOS_PCT) {
      fallidas += 1;
      // 503 es lo que devuelve Gemini saturado, y lo que la cola reintenta.
      return responder(res, 503, { mensaje: 'Doble: proveedor saturado' });
    }

    try {
      const peticion = JSON.parse(cuerpo);
      atendidas += 1;
      responder(res, 200, calificar(peticion));
    } catch (e) {
      fallidas += 1;
      responder(res, 400, { mensaje: `Doble: cuerpo ilegible (${e.message})` });
    }
  });
});

servidor.listen(PUERTO, '0.0.0.0', () => {
  console.log(
    `Doble del servicio de IA en http://127.0.0.1:${PUERTO}  ` +
      `latencia ${LATENCIA_MS}+${JITTER_MS}ms  fallos ${FALLOS_PCT}%`,
  );
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    console.log(`\nDoble detenido. Atendidas: ${atendidas}, fallidas: ${fallidas}.`);
    servidor.close(() => process.exit(0));
  });
}
