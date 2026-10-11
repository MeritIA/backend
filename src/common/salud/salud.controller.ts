import { Controller, Get, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Publico } from '../../modules/autenticacion/index.js';
import { SaludService, type EstadoGeneral } from './salud.service.js';

/** Lo minimo que se necesita de la respuesta, sin atarse a Express. */
interface RespuestaConEstado {
  status: (codigo: number) => { json: (cuerpo: unknown) => void };
}

/**
 * Vida y disponibilidad (paquete 5.5).
 *
 * SON DOS COSAS DISTINTAS, Y MEZCLARLAS ES UN ERROR OPERATIVO CONOCIDO
 *
 * - `/api/salud` responde "el proceso sirve HTTP". No toca ninguna dependencia.
 *   Es lo que mira el HEALTHCHECK del contenedor: si fallara porque la base de
 *   datos esta caida, el orquestador reiniciaria el contenedor una y otra vez
 *   sin arreglar nada.
 * - `/api/salud/listo` comprueba las cuatro dependencias que exige el criterio
 *   del paquete: base de datos, servicio de IA (con tiempo maximo),
 *   almacenamiento de objetos y cola de trabajos. Es lo que debe mirar el
 *   balanceador para decidir si mandar trafico.
 *
 * Las dos van sin version (VERSION_NEUTRAL): quien monitoriza no deberia tener
 * que seguir los cambios de version de la API.
 */
@ApiTags('salud')
@Controller({ path: 'salud', version: VERSION_NEUTRAL })
export class SaludController {
  constructor(private readonly salud: SaludService) {}

  @Publico()
  @Get()
  @ApiOperation({
    summary: 'Senal de vida del proceso',
    description:
      'Responde 200 si el proceso sirve HTTP. No comprueba dependencias: para eso esta /api/salud/listo.',
  })
  @ApiOkResponse({
    schema: {
      example: { estado: 'vivo', momento: '2026-10-04T19:30:00.000Z', enPieDesdeHaceSegundos: 42 },
    },
  })
  vida(): { estado: 'vivo'; momento: string; enPieDesdeHaceSegundos: number } {
    return {
      estado: 'vivo',
      momento: new Date().toISOString(),
      enPieDesdeHaceSegundos: Math.floor(process.uptime()),
    };
  }

  @Publico()
  @Get('listo')
  @ApiOperation({
    summary: 'Disponibilidad de las dependencias',
    description:
      'Comprueba base de datos, almacenamiento de objetos, cola de trabajos y servicio de IA, en paralelo y con tiempo maximo de 3 s cada una.\n\n' +
      'Devuelve **200** si todo esta en pie o si solo falla algo no critico (estado `degradado`), y **503** si cae una dependencia critica: sin base de datos no se puede servir nada, pero sin servicio de IA se siguen recibiendo entregas para evaluarlas despues.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        estado: 'listo',
        momento: '2026-10-04T19:30:00.000Z',
        dependencias: [
          { nombre: 'base_de_datos', estado: 'ok', critica: true, duracionMs: 3 },
          { nombre: 'almacenamiento', estado: 'ok', critica: true, duracionMs: 12 },
          { nombre: 'cola', estado: 'ok', critica: true, duracionMs: 4 },
          { nombre: 'servicio_ia', estado: 'ok', critica: false, duracionMs: 25 },
        ],
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'Una dependencia critica esta caida. El cuerpo dice cual.',
  })
  async listo(@Res({ passthrough: true }) respuesta: RespuestaConEstado): Promise<void> {
    const estado = await this.salud.comprobarTodo();
    const codigo = estado.estado === 'no_listo' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;
    // El cuerpo siempre lleva el detalle por dependencia, tambien en el 503:
    // es lo que convierte una alerta en un diagnostico.
    respuesta.status(codigo).json(estado satisfies EstadoGeneral);
  }
}
