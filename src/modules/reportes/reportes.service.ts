import { Injectable } from '@nestjs/common';

/**
 * Servicio de aplicacion del modulo de reportes.
 *
 * Es la unica via por la que otro modulo puede interactuar con reportes: nadie
 * importa sus entidades ni sus repositorios directamente.
 */
@Injectable()
export class ReportesService {}
