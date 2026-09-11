import { Injectable } from '@nestjs/common';

/**
 * Servicio de aplicacion del modulo de ejercicios.
 *
 * Es la unica via por la que otro modulo puede interactuar con ejercicios: nadie
 * importa sus entidades ni sus repositorios directamente.
 */
@Injectable()
export class EjerciciosService {}
