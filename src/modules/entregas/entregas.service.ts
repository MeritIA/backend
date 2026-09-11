import { Injectable } from '@nestjs/common';

/**
 * Servicio de aplicacion del modulo de entregas.
 *
 * Es la unica via por la que otro modulo puede interactuar con entregas: nadie
 * importa sus entidades ni sus repositorios directamente.
 */
@Injectable()
export class EntregasService {}
