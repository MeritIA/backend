/**
 * Prueba de humo del flujo completo con IA real.
 *
 *   node --env-file=.env scripts/humo-evaluacion.mjs
 *
 * Recorre lo mismo que hara una empresa el primer dia: crea su empresa y su
 * reclutador, un ejercicio con rubrica, una vacante publicada, invita a un
 * candidato, entrega un .zip y espera la nota.
 *
 * POR QUE EXISTE, SI YA HAY PRUEBAS
 *
 * Las pruebas de integracion sustituyen el servicio de IA por un doble: son
 * repetibles y no gastan cuota. Este script hace lo contrario —habla con el
 * servicio de IA de verdad, y por tanto con el proveedor— y es la unica forma
 * de comprobar que la rubrica produce una calificacion sensata y que los 503
 * del proveedor se superan con los reintentos de la cola.
 *
 * No se ejecuta en la integracion continua: necesita API key y cuesta dinero.
 */
import { deflateRawSync, crc32 } from 'node:zlib';
import { Client } from 'pg';

const BASE = process.env.HUMO_BASE_URL ?? 'http://localhost:3000';
const CONTRASENA = 'una-frase-larga-y-dificil';
const ESPERA_MAXIMA_MS = 6 * 60_000;

const nombreUnico = (prefijo) => `${prefijo}-${Date.now().toString(36)}`;

async function pedir(ruta, { token, cuerpo, metodo = 'GET' } = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  const texto = await respuesta.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!respuesta.ok) {
    throw new Error(`${metodo} ${ruta} -> ${respuesta.status}: ${texto.slice(0, 300)}`);
  }
  return datos;
}

/** Un .zip minimo, sin dependencias. */
function zipCon(archivos) {
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;

  for (const { ruta, contenido } of archivos) {
    const nombre = Buffer.from(ruta, 'utf8');
    const datos = Buffer.from(contenido, 'utf8');
    const comprimido = deflateRawSync(datos);
    const suma = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(suma, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombre);

    desplazamiento += local.length + nombre.length + comprimido.length;
  }

  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, directorio, fin]);
}

/**
 * Promueve a reclutador y le asigna empresa.
 *
 * Por SQL y no por la API a proposito: crear el primer administrador de
 * plataforma es justamente lo que todavia no tiene puerta de entrada, y es una
 * de las cosas que este script deja a la vista.
 */
async function hacerReclutadorDeEmpresa(idUsuario, nombreEmpresa) {
  const cliente = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
  await cliente.connect();
  try {
    const { rows } = await cliente.query(
      `insert into autenticacion.empresas (nombre) values ($1)
       on conflict (lower(nombre)) do update set actualizada_en = now()
       returning id`,
      [nombreEmpresa],
    );
    await cliente.query(
      'update autenticacion.usuarios set rol = $1, id_empresa = $2 where id = $3',
      ['reclutador', rows[0].id, idUsuario],
    );
    return rows[0].id;
  } finally {
    await cliente.end();
  }
}

async function esperarSalud() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/salud`);
      if (r.ok) return;
    } catch {
      // Todavia arrancando.
    }
    await new Promise((listo) => setTimeout(listo, 2000));
  }
  throw new Error(`El backend no responde en ${BASE}/api/salud`);
}

/**
 * El servicio de IA, antes de empezar.
 *
 * Sin esto, una entrega gasta sus cinco reintentos contra un servicio apagado y
 * el guion acaba diciendo "fallida" sin explicar que nadie estaba escuchando.
 */
async function exigirServicioDeIa() {
  const url = process.env.AI_SERVICE_URL;
  if (!url) throw new Error('Falta AI_SERVICE_URL en el entorno.');
  try {
    const r = await fetch(`${url}/api/salud`);
    if (!r.ok) throw new Error(`respondio ${r.status}`);
  } catch (e) {
    const causa = e instanceof Error && e.cause instanceof Error ? e.cause : undefined;
    throw new Error(
      `El servicio de IA no responde en ${url}: ${causa?.code ?? (e instanceof Error ? e.message : String(e))}.\n` +
        'Levantalo con:  cd ../ai-service && docker compose up -d --wait',
    );
  }
  console.log(`Servicio de IA: ${url} (sano)`);
}

async function main() {
  console.log(`Backend: ${BASE}`);
  await esperarSalud();
  await exigirServicioDeIa();

  const empresa = nombreUnico('Humo');
  const correoReclutador = `${nombreUnico('recl')}@humo.com`;
  const correoCandidato = `${nombreUnico('cand')}@humo.com`;

  // 1. Reclutador con empresa.
  const registro = await pedir('/api/v1/autenticacion/registro', {
    metodo: 'POST',
    cuerpo: {
      correo: correoReclutador,
      contrasena: CONTRASENA,
      nombreCompleto: 'Reclutadora De Humo',
      cliente: 'apk',
    },
  });
  await hacerReclutadorDeEmpresa(registro.idUsuario, empresa);
  const reclutador = await pedir('/api/v1/autenticacion/login', {
    metodo: 'POST',
    cuerpo: { correo: correoReclutador, contrasena: CONTRASENA, cliente: 'apk' },
  });
  console.log(`1. Reclutador listo en la empresa "${empresa}"`);

  // 2. Ejercicio con rubrica de dos criterios.
  const ejercicio = await pedir('/api/v1/ejercicios', {
    metodo: 'POST',
    token: reclutador.tokenDeAcceso,
    cuerpo: {
      titulo: 'Invertir una lista sin mutarla',
      tecnologia: 'Python',
      enunciado:
        'Implementa invertir(lista) que devuelva una NUEVA lista con los elementos en orden inverso, sin modificar la lista original. Debe manejar la lista vacia.',
      criterios: [
        {
          nombre: 'Correccion funcional',
          descripcion:
            'Invierte cualquier lista, incluida la vacia, y NO modifica la original. Si muta la lista original, el puntaje debe ser bajo.',
          peso: 70,
          escalaMaxima: 5,
        },
        {
          nombre: 'Claridad del codigo',
          descripcion: 'Nombres claros, sin codigo muerto y con el estilo idiomatico de Python.',
          peso: 30,
          escalaMaxima: 5,
        },
      ],
    },
  });
  console.log('2. Ejercicio creado con su rubrica');

  // 3. Vacante publicada con el ejercicio.
  const vacante = await pedir('/api/v1/vacantes', {
    metodo: 'POST',
    token: reclutador.tokenDeAcceso,
    cuerpo: {
      titulo: 'Desarrollador backend junior',
      descripcion: 'Vacante de la prueba de humo con IA real.',
    },
  });
  await pedir(`/api/v1/vacantes/${vacante.id}/ejercicios`, {
    metodo: 'PUT',
    token: reclutador.tokenDeAcceso,
    cuerpo: { idsDeEjercicios: [ejercicio.id] },
  });
  await pedir(`/api/v1/vacantes/${vacante.id}/publicar`, {
    metodo: 'POST',
    token: reclutador.tokenDeAcceso,
  });
  console.log('3. Vacante publicada');

  // 4. Candidato invitado.
  const candidato = await pedir('/api/v1/autenticacion/registro', {
    metodo: 'POST',
    cuerpo: {
      correo: correoCandidato,
      contrasena: CONTRASENA,
      nombreCompleto: 'Candidato De Humo',
      cliente: 'apk',
    },
  });
  await pedir(`/api/v1/vacantes/${vacante.id}/candidatos`, {
    metodo: 'POST',
    token: reclutador.tokenDeAcceso,
    cuerpo: { idCandidato: candidato.idUsuario },
  });
  console.log('4. Candidato invitado');

  // 5. Entrega con un error real: reverse() muta la lista original.
  const zip = zipCon([
    {
      ruta: 'main.py',
      contenido: 'def invertir(lista):\n    lista.reverse()\n    return lista\n',
    },
  ]);
  const formulario = new FormData();
  formulario.append('idVacante', vacante.id);
  formulario.append('idEjercicio', ejercicio.id);
  formulario.append('archivo', new Blob([zip]), 'entrega.zip');

  const respuestaEntrega = await fetch(`${BASE}/api/v1/entregas`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${candidato.tokenDeAcceso}` },
    body: formulario,
  });
  const entrega = await respuestaEntrega.json();
  if (!respuestaEntrega.ok) {
    throw new Error(`Entrega rechazada: ${JSON.stringify(entrega).slice(0, 300)}`);
  }
  console.log(`5. Entrega recibida (${entrega.estado}), esperando la evaluacion...`);

  // 6. La cola trabaja: estado y reintentos ante un 503 del proveedor.
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  let actual = entrega;
  let ultimoEstado = '';
  while (Date.now() < limite) {
    actual = await pedir(`/api/v1/entregas/${entrega.id}`, { token: candidato.tokenDeAcceso });
    if (actual.estado !== ultimoEstado) {
      ultimoEstado = actual.estado;
      console.log(`   estado: ${actual.estado}`);
    }
    if (actual.estado === 'evaluada' || actual.estado === 'fallida') break;
    await new Promise((listo) => setTimeout(listo, 3000));
  }

  if (actual.estado !== 'evaluada') {
    const motivo = actual.historial?.at(-1)?.motivo ?? 'sin motivo';
    console.error(`\nLa entrega quedo en "${actual.estado}": ${motivo}`);
    process.exitCode = 1;
    return;
  }

  // 7. La nota, con su desglose y evidencia.
  const evaluacion = await pedir(`/api/v1/evaluaciones/entrega/${entrega.id}`, {
    token: candidato.tokenDeAcceso,
  });
  console.log(`\n6. NOTA FINAL: ${evaluacion.notaFinal}/100`);
  console.log(`   proveedor: ${evaluacion.proveedor} | modelo: ${evaluacion.modelo}`);
  console.log(`   version de rubrica: ${evaluacion.idVersion}`);
  for (const c of evaluacion.criterios) {
    console.log(`\n   ${c.criterio}: ${c.puntaje}/${c.escalaMaxima} (peso ${c.peso})`);
    console.log(`     ${c.evidencia}`);
  }

  const delReclutador = await pedir(`/api/v1/evaluaciones/vacante/${vacante.id}`, {
    token: reclutador.tokenDeAcceso,
  });
  console.log(`\n7. El reclutador ve ${delReclutador.length} evaluacion(es) de su vacante`);
}

await main();
