import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SaludService } from '../common/salud/index.js';

/**
 * Registra la comprobacion de PostgreSQL (paquete 5.5).
 *
 * `select 1` y no una consulta real: lo que se quiere saber es si hay conexion
 * y si el servidor responde, no si una tabla concreta tiene datos. Una consulta
 * pesada en la pagina de estado se convierte en carga justo cuando el sistema
 * ya va mal.
 *
 * Es critica: sin base de datos no se puede atender ninguna peticion, asi que
 * su caida devuelve 503 y el balanceador deja de mandar trafico.
 */
@Injectable()
export class ComprobadorDeBaseDeDatos implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly salud: SaludService,
  ) {}

  onModuleInit(): void {
    this.salud.registrar('base_de_datos', true, async () => {
      if (!this.dataSource.isInitialized) {
        return { estado: 'caido', detalle: 'la conexion no esta inicializada' };
      }
      await this.dataSource.query('select 1');
      return { estado: 'ok' };
    });
  }
}
