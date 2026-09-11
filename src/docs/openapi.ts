import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';

/**
 * Especificacion OpenAPI generada desde el codigo.
 *
 * Paquete 5.2 de la EDT. El riesgo que la propia ficha señala es que la
 * documentacion se desactualice frente al codigo, y la mitigacion que propone
 * es justamente esta: generarla desde el codigo, no escribirla a mano. Aqui no
 * hay ningun endpoint descrito a mano; todo sale de los controladores, sus
 * decoradores y sus DTOs.
 *
 * Criterio de aceptacion: "un desarrollador externo puede consumir la API
 * unicamente con la especificacion". Por eso la descripcion, los servidores y
 * el esquema de autenticacion se declaran con detalle: sin ellos, quien
 * integre tiene que preguntar.
 */

function version(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const DESCRIPCION = `
API del backend de **MeritIA**, la plataforma de evaluacion de candidatos
mediante ejercicios practicos calificados con apoyo de inteligencia artificial
bajo rubricas definidas.

### Como esta organizada

El backend es un monolito modular con seis modulos de negocio. Cada uno agrupa
sus endpoints bajo su propia etiqueta:

| Modulo | De que responde |
|---|---|
| autenticacion | registro, inicio de sesion, renovacion de token y roles |
| vacantes | ofertas de trabajo y su asociacion con ejercicios |
| ejercicios | banco de pruebas tecnicas con sus rubricas y versiones |
| entregas | intentos de los candidatos y su estado |
| evaluacion | calificacion de las entregas contra el servicio de IA |
| reportes | resultados consolidados por vacante o por candidato |

### Autenticacion

Los tokens son **PASETO v4** con firma Ed25519, no JWT. El campo \`exp\` viaja
como cadena ISO8601. Se envian en la cabecera \`Authorization: Bearer <token>\`.

Hay tres roles: **candidato**, **reclutador** y **administrador**. La
autorizacion se comprueba por endpoint, por recurso y por operacion: pertenecer
al rol correcto no basta si el recurso es de otro usuario.

### Limites de peticiones

La API aplica limites por IP y por usuario autenticado. Los endpoints criticos
tienen los suyos propios: diez inicios de sesion por minuto y cinco entregas
cada cinco minutos.

Al superarlos se responde **429** con la cabecera \`Retry-After\` indicando los
segundos que hay que esperar.

### Errores

Ninguna respuesta de error incluye trazas de pila ni detalles internos.
`.trim();

export function construirDocumentoOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('MeritIA API')
    .setDescription(DESCRIPCION)
    .setVersion(version())
    .setContact('Equipo MeritIA', 'https://github.com/MeritIA', '')
    .setLicense('UNLICENSED', '')
    .addServer('http://localhost:3000', 'Entorno local de desarrollo')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'PASETO',
        description:
          'Token PASETO v4 obtenido en el inicio de sesion. Se envia como: Authorization: Bearer v4.public...',
      },
      'paseto',
    )
    .addTag('autenticacion', 'Registro, inicio de sesion, renovacion de token y roles')
    .addTag('vacantes', 'Ofertas de trabajo y su asociacion con ejercicios')
    .addTag('ejercicios', 'Banco de pruebas tecnicas con sus rubricas y versiones')
    .addTag('entregas', 'Intentos de los candidatos y su estado')
    .addTag('evaluacion', 'Calificacion de las entregas contra el servicio de IA')
    .addTag('reportes', 'Resultados consolidados por vacante o por candidato')
    .build();

  return SwaggerModule.createDocument(app, config);
}

/** Publica la interfaz navegable. Solo fuera de produccion, salvo orden expresa. */
export function publicarOpenApi(app: INestApplication, documento: OpenAPIObject): void {
  SwaggerModule.setup('api/docs', app, documento, {
    jsonDocumentUrl: 'api/docs/openapi.json',
    yamlDocumentUrl: 'api/docs/openapi.yaml',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'MeritIA API',
  });
}

/**
 * La interfaz navegable queda expuesta salvo que se desactive. En produccion se
 * decide con SWAGGER_UI_ENABLED: publicar el catalogo completo de endpoints
 * facilita el trabajo a quien integra, pero tambien a quien busca superficie de
 * ataque. Por omision, fuera de produccion si y en produccion no.
 */
export function debePublicarseLaInterfaz(
  entorno = process.env.NODE_ENV,
  bandera = process.env.SWAGGER_UI_ENABLED,
): boolean {
  if (bandera !== undefined && bandera !== '') return bandera === 'true';
  return entorno !== 'production';
}
