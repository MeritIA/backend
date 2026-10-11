import { Injectable, Logger, Optional } from '@nestjs/common';

/**
 * Control de admision: cuantas peticiones se dejan entrar a la vez.
 *
 * POR QUE EXISTE, CON LA MEDICION DETRAS
 *
 * Las pruebas de carga (docs/rendimiento.md) encontraron que pasado su punto de
 * caida el backend **rinde menos con mas carga**: 106, luego 78, y hasta 57
 * peticiones por segundo. No se degrada de forma elegante, se ahoga. Eso es
 * colapso por congestion, y pasa porque acepta todo lo que llega: cada peticion
 * de mas compite por el mismo event loop y alarga a todas las demas.
 *
 * Aqui se pone el freno. Pasado el tope, la peticion se rechaza **rapido** con
 * 503 y `Retry-After` en vez de entrar a una cola invisible donde espera treinta
 * segundos para fallar igual. Un rechazo claro en diez milisegundos es mejor
 * servicio que un exito en treinta segundos.
 *
 * NO SUSTITUYE AL RATE LIMITING, y no es lo mismo:
 *
 * - El rate limiting (Plan de Seguridad §4.2) protege de un ORIGEN abusivo:
 *   cuenta por IP y por usuario, y es una decision de seguridad.
 * - Esto protege al PROCESO de si mismo, sin importar quien llame. Mil usuarios
 *   legitimos a la vez no son un ataque, y aun asi hay que sobrevivirlos.
 *
 * DE DONDE SALE EL TOPE POR OMISION
 *
 * De la medicion, no del gusto. Por la ley de Little, las peticiones en vuelo
 * son rendimiento x latencia. El sistema medido daba unas 100 pet/s, y el
 * objetivo del RNF-2 es un p95 por debajo de medio segundo:
 *
 *     100 pet/s x 0,5 s = 50 peticiones en vuelo
 *
 * Por encima de eso, la cola crece mas rapido de lo que se vacia y el p95 se
 * dispara. **El valor depende de la maquina**: al cambiarla hay que repetir el
 * barrido (`test/carga/barrido.mjs`) y recalcularlo con el rendimiento real.
 */
@Injectable()
export class AdmisionService {
  private readonly logger = new Logger('Admision');
  readonly maximoEnVuelo: number;

  private enVuelo = 0;
  private saturado = false;
  private rechazadasEnEsteEpisodio = 0;
  private totalRechazadas = 0;

  /**
   * `env` va como @Optional() para que Nest no intente inyectarlo: es un
   * parametro de conveniencia para las pruebas, no una dependencia del
   * contenedor. Mismo motivo que en PasetoService y CorreoService.
   */
  constructor(@Optional() env: NodeJS.ProcessEnv = process.env) {
    const configurado = Number(env.ADMISION_MAXIMO_EN_VUELO);
    this.maximoEnVuelo = Number.isFinite(configurado) && configurado >= 0 ? configurado : 50;
  }

  /**
   * Pide permiso para entrar. Devuelve false si hay que rechazar.
   *
   * Si devuelve true, quien llama DEBE llamar a `salir()` cuando termine, pase
   * lo que pase: si se olvida en el camino de error, el contador sube para
   * siempre y el backend se bloquea solo. El middleware lo engancha a la
   * respuesta, que se cierra tanto en el exito como en el fallo.
   */
  intentarEntrar(): boolean {
    if (this.enVuelo >= this.maximoEnVuelo) {
      this.totalRechazadas += 1;
      this.rechazadasEnEsteEpisodio += 1;

      // Se registra el COMIENZO de la saturacion, no cada rechazo. Un log por
      // peticion rechazada inundaria el disco justo cuando el sistema esta
      // ahogado, que es el peor momento para darle mas trabajo.
      if (!this.saturado) {
        this.saturado = true;
        this.registrar('admision_saturada', 'warn', {
          enVuelo: this.enVuelo,
          maximo: this.maximoEnVuelo,
        });
      }
      return false;
    }

    this.enVuelo += 1;
    return true;
  }

  salir(): void {
    if (this.enVuelo > 0) this.enVuelo -= 1;

    // Se sale de la saturacion con holgura y no en el tope exacto: justo en el
    // limite, una peticion que entra y otra que sale harian entrar y salir del
    // estado en cada ciclo, y el log se llenaria de transiciones.
    if (this.saturado && this.enVuelo < this.maximoEnVuelo * 0.8) {
      this.saturado = false;
      this.registrar('admision_recuperada', 'log', {
        rechazadasEnElEpisodio: this.rechazadasEnEsteEpisodio,
        enVuelo: this.enVuelo,
      });
      this.rechazadasEnEsteEpisodio = 0;
    }
  }

  /** Para el endpoint de disponibilidad y para las pruebas. */
  metricas(): { enVuelo: number; maximo: number; saturado: boolean; rechazadas: number } {
    return {
      enVuelo: this.enVuelo,
      maximo: this.maximoEnVuelo,
      saturado: this.saturado,
      rechazadas: this.totalRechazadas,
    };
  }

  private registrar(
    evento: string,
    nivel: 'warn' | 'log',
    metadata: Record<string, unknown>,
  ): void {
    const linea = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: nivel === 'warn' ? 'warn' : 'info',
      eventType: evento,
      metadata,
    });
    if (nivel === 'warn') this.logger.warn(linea);
    else this.logger.log(linea);
  }
}
