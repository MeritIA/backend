import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdmisionService } from './admision.service.js';

/**
 * Minimo que se necesita de la peticion y la respuesta.
 *
 * Se declaran aqui en vez de importar los tipos de Express, igual que hace
 * main.ts con su manejador final: ningun archivo de src/ importa de 'express',
 * y asi el control de admision no es el primero en acoplar el proyecto al
 * framework HTTP.
 */
interface PeticionMinima {
  readonly url?: string;
  readonly originalUrl?: string;
}

interface RespuestaMinima {
  setHeader: (nombre: string, valor: string) => void;
  status: (codigo: number) => { json: (cuerpo: unknown) => void };
  on: (evento: string, oyente: () => void) => void;
}

/**
 * VA COMO MIDDLEWARE Y NO COMO GUARDIA O INTERCEPTOR, a proposito.
 *
 * En NestJS el orden es middleware -> guardias -> interceptores -> pipes. Un
 * guardia o un interceptor correrian DESPUES de la autenticacion, asi que cada
 * peticion que vamos a rechazar ya habria pagado la verificacion de la firma
 * Ed25519 de su token. Ese computo es justo el recurso que esto protege:
 * rechazar caro no sirve de nada.
 *
 * Tampoco se registra con `app.use` en main.ts: el arnes de las pruebas de
 * integracion repite ese montaje a mano, y su propio comentario advierte que si
 * los dos divergen, las pruebas verifican una aplicacion que no es la que se
 * despliega. Como middleware de un modulo, entra solo en los dos sitios.
 */
@Injectable()
export class AdmisionMiddleware implements NestMiddleware {
  constructor(private readonly admision: AdmisionService) {}

  use(peticion: PeticionMinima, respuesta: RespuestaMinima, siguiente: () => void): void {
    if (this.esDeSalud(peticion)) {
      siguiente();
      return;
    }

    if (!this.admision.intentarEntrar()) {
      // Retry-After en segundos. Le dice al cliente —y a un balanceador— que
      // esto es temporal y cuando volver, en vez de dejarlo reintentar de
      // inmediato y empeorar la saturacion que acaba de provocar el rechazo.
      respuesta.setHeader('Retry-After', '1');
      respuesta.status(503).json({
        estado: 503,
        codigo: 'SERVICIO_SATURADO',
        mensaje: 'El servicio esta recibiendo mas peticiones de las que puede atender. Reintenta en unos segundos.',
        momento: new Date().toISOString(),
        ruta: this.rutaDe(peticion),
        referencia: randomUUID(),
      });
      return;
    }

    // Se libera el cupo cuando la respuesta termina, PASE LO QUE PASE. Si se
    // liberara solo en el camino de exito, cada error dejaria un cupo ocupado
    // para siempre y el backend acabaria rechazando todo sin estar ocupado.
    //
    // Se escuchan los dos eventos porque cubren casos distintos: `finish` es la
    // respuesta enviada completa, y `close` es el cliente que corta antes
    // —justo lo que pasa bajo carga, cuando k6 o un navegador abandonan—. El
    // guardia `liberado` existe porque los dos pueden dispararse en la misma
    // peticion, y liberar dos veces descontaria un cupo ajeno.
    let liberado = false;
    const liberar = (): void => {
      if (liberado) return;
      liberado = true;
      this.admision.salir();
    };
    respuesta.on('finish', liberar);
    respuesta.on('close', liberar);

    siguiente();
  }

  private rutaDe(peticion: PeticionMinima): string {
    return (peticion.originalUrl ?? peticion.url ?? '').split('?')[0];
  }

  /**
   * Las rutas de salud nunca se rechazan.
   *
   * Si la señal de vida devolviera 503 por saturacion, el orquestador daria el
   * contenedor por muerto y lo reiniciaria **precisamente cuando esta
   * trabajando al maximo**, tirando todas las peticiones en vuelo. Es el mismo
   * razonamiento del paquete 5.5 al separar vida de disponibilidad, visto desde
   * el otro lado.
   */
  private esDeSalud(peticion: PeticionMinima): boolean {
    const prefijo = process.env.API_PREFIX ?? 'api';
    const ruta = this.rutaDe(peticion);
    return ruta === `/${prefijo}/salud` || ruta.startsWith(`/${prefijo}/salud/`);
  }
}
