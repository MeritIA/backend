import { Injectable } from '@nestjs/common';

/**
 * Servicio de aplicacion del modulo de vacantes.
 *
 * Es la unica via por la que otro modulo puede interactuar con vacantes: nadie
 * importa sus entidades ni sus repositorios directamente.
 */
@Injectable()
export class VacantesService {}
