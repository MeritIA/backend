import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { migracionesAutomaticas, opcionesDeConexion } from './data-source.js';
import { ComprobadorDeBaseDeDatos } from './comprobador-de-base-de-datos.js';

/**
 * Conexion a PostgreSQL para toda la aplicacion.
 *
 * Comparte opciones con data-source.ts para que lo que corre la CLI de
 * migraciones y lo que usa la aplicacion no puedan divergir.
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...opcionesDeConexion(),
      // Las entidades las aporta cada modulo con TypeOrmModule.forFeature, en
      // vez de descubrirlas por un patron de rutas.
      //
      // El glob dependia del directorio de trabajo y, al levantar la aplicacion
      // dentro del proceso de pruebas, cargaba cada clase dos veces: los
      // metadatos quedaban en una copia y el repositorio preguntaba por la
      // otra, con el error "No metadata for Usuario was found". Ademas el glob
      // obligaria a que este archivo conociera las rutas internas de cada
      // modulo, justo lo que las fronteras prohiben.
      autoLoadEntities: true,
      // Al arrancar, la aplicacion aplica las migraciones pendientes antes de
      // aceptar trafico: un contenedor nuevo nunca habla con un esquema viejo.
      // Se resuelven junto a este archivo y no por el directorio de trabajo,
      // por la misma razon que las entidades. Solo se buscan los .js: la
      // aplicacion corre siempre compilada; las pruebas migran por su cuenta.
      migrationsRun: migracionesAutomaticas(),
      migrations: [fileURLToPath(new URL('./migrations/*.js', import.meta.url))],
    }),
  ],
  providers: [ComprobadorDeBaseDeDatos],
})
export class DatabaseModule {}
