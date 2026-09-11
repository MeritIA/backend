import { Injectable } from '@nestjs/common';

/**
 * Servicio de aplicacion del modulo de autenticacion.
 *
 * Es la unica via por la que otro modulo puede interactuar con autenticacion: nadie
 * importa sus entidades ni sus repositorios directamente.
 */
@Injectable()
export class AutenticacionService {}
