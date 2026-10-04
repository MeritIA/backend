import { Injectable, Logger } from '@nestjs/common';

/**
 * Estado de las dependencias del backend (paquete 5.5).
 *
 * POR QUE UN REGISTRO Y NO UN SERVICIO QUE LO COMPRUEBE TODO
 *
 * Este servicio vive en `common`, y las fronteras del monolito le prohiben
 * importar modulos de negocio. Si el comprobador de la cola viviera aqui,
 * `common` tendria que conocer el modulo de evaluacion, y la regla que sostiene
 * la arquitectura se habria roto por una pantalla de monitorizacion.
 *
 * Asi que cada parte registra el suyo al arrancar: la base de datos, el
 * almacenamiento, la cola y el servicio de IA. Este servicio solo los ejecuta
 * en paralelo, les pone un tiempo maximo y resume.
 */

export type EstadoDeDependencia = 'ok' | 'degradado' | 'caido' | 'sin_configurar';

export interface ResultadoDeComprobacion {
  readonly estado: EstadoDeDependencia;
  /** Una linea para quien lee el panel. Nunca credenciales ni rutas internas. */
  readonly detalle?: string;
}

export type Comprobador = () => Promise<ResultadoDeComprobacion>;

export interface DependenciaComprobada extends ResultadoDeComprobacion {
  readonly nombre: string;
  readonly duracionMs: number;
  /**
   * Si su caida deja el backend inservible. La base de datos si; el servicio de
   * IA no: sin el se siguen recibiendo entregas, que se evaluaran luego.
   */
  readonly critica: boolean;
}

export interface EstadoGeneral {
  readonly estado: 'listo' | 'degradado' | 'no_listo';
  readonly momento: string;
  readonly dependencias: readonly DependenciaComprobada[];
}

/** Una dependencia que no responde en este tiempo se considera caida. */
export const TIEMPO_MAXIMO_POR_DEPENDENCIA_MS = 3000;

interface Registro {
  readonly nombre: string;
  readonly critica: boolean;
  readonly comprobar: Comprobador;
}

@Injectable()
export class SaludService {
  private readonly logger = new Logger('Salud');
  private readonly registros = new Map<string, Registro>();

  /**
   * Cada modulo registra su comprobacion al arrancar.
   *
   * `critica` decide si su caida impide servir trafico. Registrar dos veces el
   * mismo nombre sustituye al anterior: en las pruebas la aplicacion se levanta
   * muchas veces en el mismo proceso.
   */
  registrar(nombre: string, critica: boolean, comprobar: Comprobador): void {
    this.registros.set(nombre, { nombre, critica, comprobar });
  }

  get nombresRegistrados(): string[] {
    return [...this.registros.keys()];
  }

  /**
   * Comprueba todo en paralelo.
   *
   * En paralelo y con tiempo maximo por dependencia a proposito: en serie, una
   * dependencia colgada dejaria la pagina de estado sin responder, que es
   * justo cuando mas falta hace.
   */
  async comprobarTodo(): Promise<EstadoGeneral> {
    const dependencias = await Promise.all(
      [...this.registros.values()].map((r) => this.comprobarUna(r)),
    );

    const hayCriticaCaida = dependencias.some((d) => d.critica && d.estado === 'caido');
    const hayAlgoMal = dependencias.some((d) => d.estado === 'caido' || d.estado === 'degradado');

    return {
      estado: hayCriticaCaida ? 'no_listo' : hayAlgoMal ? 'degradado' : 'listo',
      momento: new Date().toISOString(),
      dependencias,
    };
  }

  private async comprobarUna(registro: Registro): Promise<DependenciaComprobada> {
    const inicio = Date.now();
    let resultado: ResultadoDeComprobacion;

    try {
      resultado = await this.conTiempoMaximo(registro.comprobar());
    } catch (e) {
      // El mensaje de la excepcion no se expone: puede traer cadenas de
      // conexion. Solo el tipo, que basta para saber donde mirar.
      resultado = {
        estado: 'caido',
        detalle: e instanceof Error ? e.name : 'error desconocido',
      };
      this.logger.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          eventType: 'dependencia_caida',
          metadata: {
            dependencia: registro.nombre,
            detalle: e instanceof Error ? e.message : String(e),
          },
        }),
      );
    }

    return {
      nombre: registro.nombre,
      critica: registro.critica,
      ...resultado,
      duracionMs: Date.now() - inicio,
    };
  }

  private async conTiempoMaximo(
    promesa: Promise<ResultadoDeComprobacion>,
  ): Promise<ResultadoDeComprobacion> {
    let temporizador: NodeJS.Timeout | undefined;
    const limite = new Promise<ResultadoDeComprobacion>((resolver) => {
      temporizador = setTimeout(
        () => resolver({ estado: 'caido', detalle: 'no respondio a tiempo' }),
        TIEMPO_MAXIMO_POR_DEPENDENCIA_MS,
      );
    });

    // Si gana el limite, la promesa original puede rechazar despues.
    promesa.catch(() => undefined);

    try {
      return await Promise.race([promesa, limite]);
    } finally {
      clearTimeout(temporizador);
    }
  }
}
