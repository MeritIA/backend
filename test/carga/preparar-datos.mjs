/**
 * Siembra el escenario de las pruebas de carga y deja los tokens listos.
 *
 *   node --env-file=.env.carga test/carga/preparar-datos.mjs
 *
 * Escribe `test/carga/datos-de-carga.json`, que es lo que leen los guiones de
 * k6. Ese archivo lleva tokens de sesion reales, asi que NO se versiona (esta
 * en .gitignore).
 *
 * TRES DECISIONES QUE AFECTAN LO QUE SE MIDE
 *
 * 1. **Base de datos aparte, `meritia_carga`.** Una corrida crea miles de
 *    candidatos y entregas; hacerlo sobre la base de desarrollo destruiria el
 *    entorno de quien este probando a mano, igual que las pruebas de
 *    integracion usan la suya.
 *
 * 2. **Los tokens se crean aqui, una vez, y los reusa k6.** Iniciar sesion en
 *    cada peticion mediria argon2id —que es caro A PROPOSITO, es la defensa
 *    contra fuerza bruta— y el perfil de la carga seria el del hash y no el de
 *    la aplicacion. El login tiene su propio escenario, con su propio numero.
 *
 * 3. **Un candidato puede entregar como maximo `intentos` veces por
 *    ejercicio**, por la restriccion unica de la tabla. El tope de entregas de
 *    toda la corrida es `CANDIDATOS x INTENTOS`; si un escenario lo supera,
 *    empezara a recibir 409 legitimos. Esta impreso al final.
 */
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { crc32, deflateRawSync } from 'node:zlib';
import { Client } from 'pg';

const BASE = process.env.CARGA_URL_BASE ?? 'http://127.0.0.1:3000';
const BD = process.env.DATABASE_NAME ?? 'meritia_carga';
const CANDIDATOS = Number(process.env.CARGA_CANDIDATOS ?? 60);
const INTENTOS = 10; // INTENTOS_MAXIMOS del dominio de entregas.
const CONTRASENA = 'una-frase-larga-y-dificil';
const SALIDA = 'test/carga/datos-de-carga.json';

const conexion = (database) => ({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database,
});

async function sql(database, texto, parametros = []) {
  const cliente = new Client(conexion(database));
  await cliente.connect();
  try {
    const { rows } = await cliente.query(texto, parametros);
    return rows;
  } finally {
    await cliente.end();
  }
}

async function crearBaseSiFalta() {
  const existe = await sql('postgres', 'select 1 from pg_database where datname = $1', [BD]);
  if (existe.length === 0) {
    // No admite parametros en el nombre; BD no viene de entrada de usuario.
    await sql('postgres', `create database "${BD}"`);
    console.log(`Base ${BD} creada.`);
  } else {
    console.log(`Base ${BD} ya existia.`);
  }
}

function migrar() {
  // Las migraciones compiladas: este guion corre fuera de vitest, con node.
  const r = spawnSync(
    process.execPath,
    ['node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/database/data-source.js'],
    { env: { ...process.env, DATABASE_NAME: BD }, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(
      `Fallaron las migraciones sobre ${BD}. ¿Esta compilado el proyecto (npm run build)?\n` +
        `${r.stdout ?? ''}${r.stderr ?? ''}`,
    );
  }
  console.log(`Migraciones aplicadas sobre ${BD}.`);
}

async function esperarBackend() {
  for (let i = 1; i <= 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/salud`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        console.log(`Backend respondiendo en ${BASE}.`);
        return;
      }
    } catch {
      // Todavia no levanta; se vuelve a intentar.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `El backend no responde en ${BASE}.\n` +
      'Levantalo apuntando a la base de carga:\n' +
      `  DATABASE_NAME=${BD} npm run start:prod`,
  );
}

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: { 'content-type': 'application/json', ...(opciones.headers ?? {}) },
  });
  const texto = await r.text();
  if (!r.ok) {
    throw new Error(`${opciones.method ?? 'GET'} ${ruta} -> ${r.status}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

async function registrar(correo, nombre) {
  return pedir('/api/v1/autenticacion/registro', {
    method: 'POST',
    body: JSON.stringify({
      correo,
      contrasena: CONTRASENA,
      nombreCompleto: nombre,
      cliente: 'apk',
    }),
  });
}

/**
 * Un .zip minimo y valido, armado en memoria.
 *
 * Se genera aqui en vez de versionar un binario, y es el MISMO en cada corrida:
 * si el contenido cambiara, cambiaria el trabajo que hace la extraccion de
 * texto y dos corridas no serian comparables.
 */
function zipDeEntrega() {
  const archivos = [
    {
      ruta: 'invertir.py',
      contenido: `def invertir(lista: list) -> list:
    """Devuelve una lista nueva en orden inverso."""
    return lista[::-1]
`,
    },
    {
      ruta: 'README.md',
      contenido: `# Entrega de carga

Solucion del ejercicio.
`,
    },
  ];

  const locales = [];
  const centrales = [];
  let desplazamiento = 0;

  for (const archivo of archivos) {
    const nombre = Buffer.from(archivo.ruta, 'utf8');
    const datos = Buffer.from(archivo.contenido, 'utf8');
    const comprimido = deflateRawSync(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(datos), 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(datos), 16);
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
 * Sufijo en letras para el nombre del candidato.
 *
 * La validacion del registro NO admite digitos en nombreCompleto —solo letras,
 * espacios, apostrofos, puntos y guiones—, asi que "Candidato Carga 12" es un
 * 400. Es una regla del dominio, no un estorbo: se respeta.
 */
function sufijoEnLetras(n) {
  let resultado = '';
  let i = n;
  do {
    resultado = String.fromCharCode(65 + (i % 26)) + resultado;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return resultado;
}

async function main() {
  await crearBaseSiFalta();
  migrar();
  await esperarBackend();

  const sello = Date.now();

  // --- Reclutador. El registro publico solo crea candidatos, asi que el rol se
  // --- promueve en la base, igual que en las pruebas de integracion.
  const correoReclutador = `reclutador-carga-${sello}@ejemplo.com`;
  const reclutador = await registrar(correoReclutador, 'Reclutador De Carga');
  const [empresa] = await sql(
    BD,
    `insert into autenticacion.empresas (nombre) values ($1)
     on conflict (lower(nombre)) do update set actualizada_en = now() returning id`,
    ['Empresa de carga'],
  );
  await sql(BD, 'update autenticacion.usuarios set rol = $1, id_empresa = $2 where id = $3', [
    'reclutador',
    empresa.id,
    reclutador.idUsuario,
  ]);
  const sesionReclutador = await pedir('/api/v1/autenticacion/login', {
    method: 'POST',
    body: JSON.stringify({ correo: correoReclutador, contrasena: CONTRASENA, cliente: 'apk' }),
  });
  const authReclutador = { Authorization: `Bearer ${sesionReclutador.tokenDeAcceso}` };

  // --- Ejercicio y vacante.
  const ejercicio = await pedir('/api/v1/ejercicios', {
    method: 'POST',
    headers: authReclutador,
    body: JSON.stringify({
      titulo: `Ejercicio de carga ${sello}`,
      enunciado:
        'Implementa una funcion que invierta una lista sin modificar la original. ' +
        'Debe funcionar con la lista vacia.',
      criterios: [
        {
          nombre: 'Correccion funcional',
          descripcion: 'Invierte cualquier lista, no modifica la original y soporta la vacia.',
          peso: 70,
          escalaMaxima: 5,
        },
        {
          nombre: 'Claridad del codigo',
          descripcion: 'Nombres descriptivos y estructura simple.',
          peso: 30,
          escalaMaxima: 5,
        },
      ],
    }),
  });

  const vacante = await pedir('/api/v1/vacantes', {
    method: 'POST',
    headers: authReclutador,
    body: JSON.stringify({
      titulo: `Vacante de carga ${sello}`,
      descripcion: 'Vacante usada solo por las pruebas de carga.',
      intentosPermitidos: INTENTOS,
    }),
  });
  await pedir(`/api/v1/vacantes/${vacante.id}/ejercicios`, {
    method: 'PUT',
    headers: authReclutador,
    body: JSON.stringify({ idsDeEjercicios: [ejercicio.id] }),
  });
  await pedir(`/api/v1/vacantes/${vacante.id}/publicar`, {
    method: 'POST',
    headers: authReclutador,
  });

  // --- Candidatos, invitados y con su token listo.
  const candidatos = [];
  for (let i = 0; i < CANDIDATOS; i++) {
    const correo = `candidato-carga-${sello}-${i}@ejemplo.com`;
    const sesion = await registrar(correo, `Candidato Carga ${sufijoEnLetras(i)}`);
    await pedir(`/api/v1/vacantes/${vacante.id}/candidatos`, {
      method: 'POST',
      headers: authReclutador,
      body: JSON.stringify({ idCandidato: sesion.idUsuario }),
    });
    candidatos.push({ id: sesion.idUsuario, token: sesion.tokenDeAcceso });
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${CANDIDATOS} candidatos listos`);
  }

  // --- Evaluaciones previas, para que el mentor tenga con que trabajar.
  // Sin ellas responde sin llamar a la IA y el escenario del mentor no mediria
  // nada. Llevan vacante y ejercicio propios: no ensucian el reporte de la vacante.
  await sql(
    BD,
    `with nuevas as (
       insert into evaluacion.evaluaciones (id_entrega, id_vacante, id_candidato, id_empresa, id_ejercicio,
         id_version, nota_final, proveedor, modelo, archivos, riesgo_inyeccion, creada_en)
       select gen_random_uuid(), gen_random_uuid(), c, gen_random_uuid(), gen_random_uuid(),
         gen_random_uuid(), 40 + (n * 17) % 55, 'doble-de-carga', 'doble-1', 1, 'ninguno', now() - (n || ' days')::interval
       from unnest($1::uuid[]) c, generate_series(1, 3) n
       returning id, nota_final
     )
     insert into evaluacion.calificaciones_criterio (id_evaluacion, orden, criterio, puntaje, escala_maxima, peso, evidencia)
     select id, k, case k when 1 then 'Correccion funcional' else 'Claridad del codigo' end,
            round((nota_final / 100.0 * 5)::numeric, 1), 5, 50,
            'Evidencia de carga: ' || repeat('texto ', 40)
     from nuevas, generate_series(1, 2) k`,
    [candidatos.map((c) => c.id)],
  );

  const datos = {
    generadoEn: new Date().toISOString(),
    base: BD,
    urlBase: BASE,
    idVacante: vacante.id,
    idEjercicio: ejercicio.id,
    intentosPorCandidato: INTENTOS,
    reclutador: { id: reclutador.idUsuario, token: sesionReclutador.tokenDeAcceso },
    candidatos,
  };
  writeFileSync(SALIDA, JSON.stringify(datos, null, 2));
  writeFileSync('test/carga/entrega-de-carga.zip', zipDeEntrega());

  console.log(
    `\n${SALIDA} escrito.\n` +
      `  vacante ${vacante.id}\n` +
      `  ${candidatos.length} candidatos x ${INTENTOS} intentos = ` +
      `${candidatos.length * INTENTOS} entregas como maximo en toda la corrida\n`,
  );
}

main().catch((e) => {
  console.error(`\nNo se pudo preparar la carga: ${e.message}`);
  process.exit(1);
});
