/**
 * Siembra datos de demostracion en la base de DESARROLLO.
 *
 *   node --env-file=.env scripts/sembrar-demo.mjs
 *
 * Deja una empresa, un reclutador, cuatro candidatos y tres vacantes
 * publicadas en estados distintos, para que el panel A02 y el ranking A06 del
 * frontend tengan algo que mostrar: una vacante con avance a medias, una que
 * se paso de su cierre estimado, y una sin nadie invitado.
 *
 * TODO LO QUE PUEDE PASAR POR LA API, PASA POR LA API
 *
 * Y no es manía: las columnas `archivo_nombre`, `nombre_completo` y `correo`
 * estan CIFRADAS con AES-256-GCM. Un `insert` a mano les mete texto en claro,
 * nadie se entera hasta que algo las lee, y entonces revienta con un
 * "Formato invalido: se esperaba iv:authTag:ciphertext en base64" que no
 * apunta a la causa. Paso exactamente eso al sembrar la primera vez: la
 * pantalla A07 devolvia 500 al descargar el entregable.
 *
 * Lo UNICO que se hace con SQL son dos cosas que la API no ofrece a proposito:
 * promover a un usuario a reclutador, y escribir evaluaciones. Lo segundo es
 * deliberado: pasar por la cola gastaria cuota real de Gemini para pintar una
 * barra de progreso. Para probar la IA de verdad esta `humo-evaluacion.mjs`.
 *
 * NO SE EJECUTA EN LA INTEGRACION CONTINUA y no toca la base de pruebas.
 */
import { Client } from 'pg';

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';
const API = `${BASE}/api/v1`;
const CONTRASENA = 'una-frase-larga-y-dificil';

const CANDIDATOS = [
  ['ana@ejemplo.com', 'Ana Maria Rojas'],
  ['luis@ejemplo.com', 'Luis Perez'],
  ['sara@ejemplo.com', 'Sara Gomez'],
  ['diego@ejemplo.com', 'Diego Ramirez'],
];

/**
 * Las tres vacantes, cada una enseñando un caso distinto del panel.
 *
 * LA DESCRIPCION ES DISTINTA EN CADA UNA, Y NO ES DECORACION
 *
 * Antes las tres compartian una sola frase generica. Dos consecuencias feas:
 * el catalogo parecia roto --tres ofertas de cargos distintos diciendo lo
 * mismo-- y el boton "Ver mas" de la pantalla de explorar no mostraba nada,
 * porque con una linea de texto no hay nada que el recorte de tres lineas
 * esconda. Un texto realista es ademas lo unico que deja ver si la tarjeta
 * aguanta descripciones largas.
 */
const VACANTES = [
  {
    titulo: 'Desarrollador backend junior',
    dias: 12,
    plan: 3,
    invitar: 4,
    evaluar: 2,
    descripcion:
      'Mantendras y ampliaras los servicios que registran el avance de obra: APIs en Node, ' +
      'el modelo de datos en PostgreSQL y las integraciones con los equipos de campo. ' +
      'Trabajaras con alguien senior en las revisiones de codigo y entraras al turno de ' +
      'soporte cuando lleves tres meses. No pedimos experiencia previa en construccion; ' +
      'si ganas de entender el negocio.',
  },
  {
    titulo: 'Analista de datos de obra',
    dias: -5,
    plan: 2,
    invitar: 3,
    evaluar: 3,
    descripcion:
      'Consolidaras los datos de avance, costos y rendimiento que hoy viven repartidos entre ' +
      'hojas de calculo y los sistemas de cada proyecto. Construiras los tableros que usan ' +
      'los directores de obra para decidir cada semana, y propondras que medir cuando nadie ' +
      'lo haya definido. Trabajo cercano a residentes e interventoria, con visitas ' +
      'ocasionales a obra.',
  },
  {
    titulo: 'Ingeniero de calidad',
    dias: null,
    plan: null,
    invitar: 0,
    evaluar: 0,
    descripcion:
      'Definiras y haras cumplir los protocolos de calidad en obra: ensayos de materiales, ' +
      'liberacion de actividades y cierre de no conformidades. Acompanaras a los residentes ' +
      'en sitio, documentaras hallazgos y llevaras los indicadores que se presentan al ' +
      'cliente. Buscamos criterio tecnico y mano firme para sostener un estandar cuando el ' +
      'cronograma aprieta.',
  },
];

function conexion() {
  return new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
}

async function sql(texto, parametros = []) {
  const cliente = conexion();
  await cliente.connect();
  try {
    const { rows } = await cliente.query(texto, parametros);
    return rows;
  } finally {
    await cliente.end();
  }
}

async function llamar(ruta, { metodo = 'POST', cuerpo, token, formulario } = {}) {
  const respuesta = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      ...(formulario ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formulario ?? (cuerpo ? JSON.stringify(cuerpo) : undefined),
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) throw new Error(`${metodo} ${ruta} -> ${respuesta.status} ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

/** Registra la cuenta si no existe y devuelve su sesion de APK, con token. */
async function cuenta(correo, nombre) {
  try {
    await llamar('/autenticacion/registro', {
      cuerpo: { correo, contrasena: CONTRASENA, nombreCompleto: nombre, cliente: 'apk' },
    });
  } catch (error) {
    // Repetir el script no debe fallar: si ya existe, se inicia sesion y ya.
    if (!/409|ya existe|registrad/i.test(String(error))) throw error;
  }
  const sesion = await llamar('/autenticacion/login', {
    cuerpo: { correo, contrasena: CONTRASENA, cliente: 'apk' },
  });
  return { id: sesion.idUsuario, token: sesion.tokenDeAcceso, correo };
}

const enDias = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString();

async function main() {
  // 1. El reclutador y su empresa.
  //
  // Promover a reclutador es lo unico que se hace con SQL aqui, y a proposito:
  // la API no lo ofrece porque crear empresas es cosa de un administrador de
  // plataforma, que en un entorno de desarrollo todavia no existe.
  const recienCreado = await cuenta('laura@empresa-demo.com', 'Laura Venegas');
  const [empresa] = await sql(
    `insert into autenticacion.empresas (nombre, sector, nit)
       values ('Constructora del Norte', 'construccion', '900123456')
       on conflict (lower(nombre)) do update set actualizada_en = now()
       returning id`,
  );
  await sql(`update autenticacion.usuarios set rol = 'reclutador', id_empresa = $1 where id = $2`, [
    empresa.id,
    recienCreado.id,
  ]);

  // El token anterior lleva el rol viejo: hay que pedir uno nuevo.
  const jefe = await cuenta('laura@empresa-demo.com', 'Laura Venegas');

  // 2. Los candidatos.
  const gente = [];
  for (const [correo, nombre] of CANDIDATOS) gente.push(await cuenta(correo, nombre));

  // 3. Un reto en el banco, con dos criterios que suman 100.
  const ejercicio = await llamar('/ejercicios', {
    token: jefe.token,
    cuerpo: {
      titulo: `Diseno de API de obra ${Date.now()}`,
      enunciado:
        'Disena el modelo de datos y los endpoints para registrar avances de obra, ' +
        'con control de acceso por proyecto y auditoria de cambios.',
      criterios: [
        {
          nombre: 'Correccion funcional',
          descripcion: 'El modelo cubre los casos del enunciado, incluidos los limite.',
          peso: 60,
          escalaMaxima: 5,
        },
        {
          nombre: 'Comunicacion escrita',
          descripcion: 'Las decisiones estan explicadas y se entienden sin preguntar.',
          peso: 40,
          escalaMaxima: 5,
        },
      ],
    },
  });

  for (const plantilla of VACANTES) {
    const vacante = await llamar('/vacantes', {
      token: jefe.token,
      cuerpo: {
        titulo: plantilla.titulo,
        descripcion: plantilla.descripcion,
        ...(plantilla.dias === null ? {} : { cierreEstimado: enDias(plantilla.dias) }),
        ...(plantilla.plan === null ? {} : { finalistasAEvaluar: plantilla.plan }),
      },
    });
    await llamar(`/vacantes/${vacante.id}/ejercicios`, {
      metodo: 'PUT',
      token: jefe.token,
      cuerpo: { idsDeEjercicios: [ejercicio.id] },
    });
    await llamar(`/vacantes/${vacante.id}/publicar`, { token: jefe.token });

    const invitados = gente.slice(0, plantilla.invitar);
    for (const quien of invitados) {
      await llamar(`/vacantes/${vacante.id}/candidatos`, {
        token: jefe.token,
        cuerpo: { idCandidato: quien.id },
      });
    }

    for (const [indice, quien] of invitados.slice(0, plantilla.evaluar).entries()) {
      // La entrega PASA POR LA API: sube el archivo de verdad al
      // almacenamiento y cifra el nombre. Insertarla a mano es el error que
      // esta cabecera cuenta.
      const formulario = new FormData();
      formulario.append('idVacante', vacante.id);
      formulario.append('idEjercicio', ejercicio.id);
      formulario.append(
        'archivo',
        new Blob([`# Solucion de ${quien.correo}\n\nModelo de datos y endpoints.\n`], {
          type: 'text/markdown',
        }),
        'solucion.md',
      );
      const entrega = await llamar('/entregas', {
        token: quien.token,
        formulario,
      });

      // La evaluacion si va por SQL: pasar por la cola gastaria cuota real.
      const [evaluacion] = await sql(
        `insert into evaluacion.evaluaciones
           (id_entrega, id_vacante, id_candidato, id_empresa, id_ejercicio, id_version,
            nota_final, proveedor, modelo, archivos, riesgo_inyeccion, creada_en)
         values ($1, $2, $3, $4, $5, gen_random_uuid(), $6,
                 'gemini', 'gemini-3.5-flash', 1, 'ninguno', now())
         returning id`,
        [entrega.id, vacante.id, quien.id, empresa.id, ejercicio.id, 88 - indice * 11],
      );
      await sql(
        `insert into evaluacion.calificaciones_criterio
           (id_evaluacion, orden, criterio, puntaje, escala_maxima, peso, evidencia)
         values ($1, 0, 'Correccion funcional', 4, 5, 60, $2),
                ($1, 1, 'Comunicacion escrita', 3, 5, 40, $3)`,
        [
          evaluacion.id,
          'En el apartado de modelo, resuelve el caso de una obra sin avances registrados.',
          'Explica por que separa avance de hito, aunque no justifica el formato de las fechas.',
        ],
      );
      await sql(`update entregas.entregas set estado = 'evaluada' where id = $1`, [entrega.id]);
    }

    console.log(`vacante lista: ${plantilla.titulo}`);
  }

  console.log(`\nEntra con  laura@empresa-demo.com  /  ${CONTRASENA}`);
}

main().catch((error) => {
  console.error('FALLO:', error.message);
  process.exit(1);
});
