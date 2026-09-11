import { Injectable } from '@nestjs/common';

/**
 * Servicio de aplicacion del modulo de evaluacion.
 *
 * Es la unica via por la que otro modulo puede interactuar con evaluacion: nadie
 * importa sus entidades ni sus repositorios directamente.
 */
@Injectable()
export class EvaluacionService {}
