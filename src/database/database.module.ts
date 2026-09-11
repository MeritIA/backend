import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { opcionesDeConexion } from './data-source.js';

/**
 * Conexion a PostgreSQL para toda la aplicacion.
 *
 * Comparte opciones con data-source.ts para que lo que corre la CLI de
 * migraciones y lo que usa la aplicacion no puedan divergir.
 */
@Module({
  imports: [TypeOrmModule.forRoot(opcionesDeConexion())],
})
export class DatabaseModule {}
