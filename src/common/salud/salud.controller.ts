import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Publico } from '../../modules/autenticacion/index.js';

/**
 * Senal de vida del proceso.
 *
 * ALCANCE, a proposito estrecho: esto responde unicamente a "el proceso esta
 * levantado y sirviendo HTTP". NO comprueba la base de datos, ni Redis, ni el
 * almacenamiento de objetos, ni el servicio de IA.
 *
 * La observabilidad completa que pide la seccion 15 del encuadre —distinguir
 * *application health*, *database availability* y *dependency availability*— es
 * el paquete 5.5 de la EDT, de Daniel Eduardo Useche Pinilla. Aqui solo se
 * cubre lo minimo que el HEALTHCHECK del contenedor necesita para no marcar la
 * imagen como enferma para siempre.
 *
 * Mezclar las dos cosas seria un error operativo conocido: si la comprobacion
 * de vida fallara porque la base de datos esta caida, el orquestador reiniciaria
 * el contenedor una y otra vez sin arreglar nada, en vez de dejarlo vivo y
 * marcarlo como no listo para recibir trafico.
 *
 * Va sin version (VERSION_NEUTRAL) para que la ruta no cambie al versionar la
 * API: quien monitoriza no deberia tener que seguir esos cambios.
 */
@ApiTags('salud')
@Controller({ path: 'salud', version: VERSION_NEUTRAL })
export class SaludController {
  @Publico()
  @Get()
  @ApiOperation({
    summary: 'Senal de vida del proceso',
    description:
      'Responde 200 si el proceso sirve HTTP. No comprueba base de datos ni dependencias: para eso esta el readiness del paquete 5.5.',
  })
  @ApiOkResponse({
    schema: {
      example: { estado: 'vivo', momento: '2026-09-11T19:30:00.000Z', enPieDesdeHaceSegundos: 42 },
    },
  })
  vida(): { estado: 'vivo'; momento: string; enPieDesdeHaceSegundos: number } {
    return {
      estado: 'vivo',
      momento: new Date().toISOString(),
      enPieDesdeHaceSegundos: Math.floor(process.uptime()),
    };
  }
}
