import type { ValueTransformer } from 'typeorm';
import { CifradoService } from './cifrado.service.js';

/**
 * Transformador de TypeORM que cifra al escribir y descifra al leer.
 *
 * Es el entregable central del paquete 1.3: con el, marcar una columna como
 * sensible es una linea en la entidad y nadie tiene que acordarse de cifrar a
 * mano en cada servicio.
 *
 *   @Column({ type: 'text', transformer: columnaCifrada() })
 *   documentoIdentidad!: string;
 *
 * Segun el Plan de Seguridad §5.2 se cifran las credenciales de API de
 * terceros, la informacion de identificacion personal (nombres completos,
 * correos, documentos) y los tokens guardados en base de datos.
 *
 * Aviso sobre busquedas: una columna cifrada con IV aleatorio no se puede
 * comparar por igualdad en SQL ni indexar de forma util, porque el mismo valor
 * produce cifrados distintos. Si hace falta buscar por un dato sensible, se
 * guarda aparte un hash deterministico de ese valor y se busca por el hash.
 */

let servicioCompartido: CifradoService | undefined;

/**
 * El servicio se crea la primera vez que se usa, no al importar el modulo.
 * Asi la validacion de ENCRYPTION_KEY ocurre cuando el entorno ya esta
 * cargado, y las pruebas pueden inyectar su propia clave.
 */
function servicio(): CifradoService {
  servicioCompartido ??= new CifradoService();
  return servicioCompartido;
}

/** Solo para pruebas: fuerza el servicio que usara el transformador. */
export function establecerServicioDeCifrado(s: CifradoService | undefined): void {
  servicioCompartido = s;
}

export function columnaCifrada(): ValueTransformer {
  return {
    /** Hacia la base de datos. */
    to(valor: string | null | undefined): string | null {
      if (valor === null || valor === undefined) return null;
      return servicio().cifrar(valor);
    },

    /** Desde la base de datos. */
    from(valor: string | null | undefined): string | null {
      if (valor === null || valor === undefined) return null;
      return servicio().descifrar(valor);
    },
  };
}
