import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BusDeEventos } from '../events/index.js';
import { CorreoService } from './correo.js';
import {
  EVENTO_DE_SEGURIDAD,
  type EventoDeSeguridad,
  type TipoDeEventoDeSeguridad,
} from './evento-de-seguridad.js';

/**
 * Alertas de seguridad en tiempo real (paquete 5.5).
 *
 * Criterio del paquete: "alertas en tiempo real para fallos de autenticacion
 * repetidos, rate limit excedido e intentos de inyeccion", y "las alertas
 * criticas notifican al responsable en tiempo real". El canal es el correo,
 * elegido por el equipo.
 *
 * LAS DOS DECISIONES QUE IMPORTAN
 *
 * 1. **Umbral, no cada evento.** Un fallo de login es la vida normal de
 *    cualquier sistema: avisar de cada uno garantiza que nadie lea los avisos.
 *    Se avisa cuando el patron deja de ser normal: varios fallos de la misma
 *    clave en una ventana corta.
 * 2. **Silencio tras avisar.** Un ataque genera miles de eventos; sin freno,
 *    miles de correos. Tras una alerta, esa regla y esa clave quedan calladas un
 *    rato, y el siguiente aviso dice cuantas veces paso mientras callaba.
 *
 * LIMITE CONOCIDO: los contadores viven en memoria. Con varias instancias, cada
 * una cuenta las suyas, asi que los umbrales se alcanzan mas tarde. Llevarlos a
 * Redis es el paso natural; se deja escrito antes que resuelto a medias.
 */

interface Regla {
  /** Cuantos eventos de la misma clave disparan la alerta. */
  readonly umbral: number;
  /** Ventana en la que se cuentan. */
  readonly ventanaMs: number;
  /** Cuanto calla esa regla y esa clave despues de avisar. */
  readonly silencioMs: number;
  readonly asunto: string;
}

const MINUTO = 60_000;

export const REGLAS: Record<TipoDeEventoDeSeguridad, Regla> = {
  // Cinco fallos de la misma clave en cinco minutos. Un dedo torpe no llega;
  // un barrido de contrasenas, si.
  auth_failure: {
    umbral: 5,
    ventanaMs: 5 * MINUTO,
    silencioMs: 15 * MINUTO,
    asunto: 'MeritIA: fallos de autenticacion repetidos',
  },
  // El limite ya devuelve 429 por su cuenta; la alerta es para el patron
  // sostenido del que habla el Plan de Seguridad §9.2.
  rate_limit_exceeded: {
    umbral: 10,
    ventanaMs: 5 * MINUTO,
    silencioMs: 15 * MINUTO,
    asunto: 'MeritIA: limite de peticiones excedido de forma sostenida',
  },
  // Inmediata: una entrega que intenta manipular al evaluador es un hecho
  // aislado y hay que revisarla a mano.
  inyeccion_detectada: {
    umbral: 1,
    ventanaMs: 5 * MINUTO,
    silencioMs: 5 * MINUTO,
    asunto: 'MeritIA: intento de inyeccion en una entrega',
  },
};

interface Contador {
  momentos: number[];
  calladaHasta: number;
  omitidasMientrasCallaba: number;
}

@Injectable()
export class AlertasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Alertas');
  private readonly contadores = new Map<string, Contador>();
  private cancelarSuscripcion?: () => void;

  constructor(
    private readonly bus: BusDeEventos,
    private readonly correo: CorreoService,
  ) {}

  onModuleInit(): void {
    this.cancelarSuscripcion = this.bus.suscribir<EventoDeSeguridad>(
      EVENTO_DE_SEGURIDAD,
      async (evento) => {
        await this.procesar(evento.payload);
      },
    );
  }

  onModuleDestroy(): void {
    this.cancelarSuscripcion?.();
  }

  /**
   * Registra el evento y decide si avisar.
   *
   * El registro es SIEMPRE, con marca de tiempo, tipo, usuario, IP y ruta, que
   * es el primer criterio de aceptacion del paquete. La alerta es lo que
   * depende del umbral.
   */
  async procesar(evento: EventoDeSeguridad, ahora = Date.now()): Promise<void> {
    this.logger.warn(
      JSON.stringify({
        timestamp: evento.momento,
        level: 'security',
        eventType: evento.tipo,
        userId: evento.userId ?? '',
        ip: evento.ip ?? '',
        path: evento.ruta ?? '',
        method: evento.metodo ?? '',
        metadata: evento.metadata ?? {},
      }),
    );

    const regla = REGLAS[evento.tipo];
    const id = `${evento.tipo}|${evento.clave}`;
    const contador = this.contadores.get(id) ?? {
      momentos: [],
      calladaHasta: 0,
      omitidasMientrasCallaba: 0,
    };
    this.contadores.set(id, contador);

    // El silencio se comprueba ANTES del umbral: lo que se cuenta como omitido
    // es todo lo que llego mientras callabamos, no solo lo que habria vuelto a
    // disparar la alerta. Es la cifra que le sirve a quien lee el correo.
    if (ahora < contador.calladaHasta) {
      contador.omitidasMientrasCallaba++;
      return;
    }

    contador.momentos = contador.momentos.filter((m) => ahora - m < regla.ventanaMs);
    contador.momentos.push(ahora);

    if (contador.momentos.length < regla.umbral) return;

    const omitidas = contador.omitidasMientrasCallaba;
    contador.calladaHasta = ahora + regla.silencioMs;
    contador.omitidasMientrasCallaba = 0;
    contador.momentos = [];

    await this.avisar(evento, regla, omitidas);
  }

  private async avisar(
    evento: EventoDeSeguridad,
    regla: Regla,
    omitidasAntes: number,
  ): Promise<void> {
    const lineas = [
      `Tipo: ${evento.tipo}`,
      `Momento: ${evento.momento}`,
      `Umbral: ${regla.umbral} en ${Math.round(regla.ventanaMs / MINUTO)} minutos`,
      `Clave: ${evento.clave}`,
      ...(evento.userId ? [`Usuario: ${evento.userId}`] : []),
      ...(evento.ip ? [`IP: ${evento.ip}`] : []),
      ...(evento.ruta ? [`Ruta: ${evento.metodo ?? ''} ${evento.ruta}`.trim()] : []),
      ...(evento.metadata ? [`Detalle: ${JSON.stringify(evento.metadata)}`] : []),
      ...(omitidasAntes > 0
        ? [``, `Durante el silencio anterior se omitieron ${omitidasAntes} avisos iguales.`]
        : []),
      ``,
      `Siguiente aviso de esta regla y esta clave: no antes de ${Math.round(regla.silencioMs / MINUTO)} minutos.`,
    ];

    const enviada = await this.correo.enviar(regla.asunto, lineas.join('\n'));

    this.logger.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType: 'alerta_disparada',
        metadata: {
          tipo: evento.tipo,
          clave: evento.clave,
          enviadaPorCorreo: enviada,
          omitidasAntes,
        },
      }),
    );
  }
}
