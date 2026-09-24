import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { DomainEvent } from './domain-event.js';

export type ManejadorDeEvento<T> = (evento: DomainEvent<T>) => void | Promise<void>;

/**
 * Bus de eventos internos del monolito.
 *
 * El planteamiento de arquitectura pide que el flujo entregas -> evaluacion ->
 * reportes viaje por eventos y no por llamadas directas, para que cada modulo
 * quede desacoplado del siguiente. Este bus es ese canal.
 *
 * Se escribe a mano en vez de anadir @nestjs/event-emitter: son cuarenta lineas,
 * y la politica de dependencias del encuadre pide no sumar una libreria para lo
 * que el lenguaje ya resuelve.
 *
 * DOS GARANTIAS Y UN LIMITE
 *
 * - La entrega es ASINCRONA: quien publica no espera a los suscriptores. Una
 *   entrega de candidato no puede tardar lo que tarde la evaluacion.
 * - Un suscriptor que falla NO rompe al que publica ni a los demas
 *   suscriptores: el error se registra y ahi queda. Si no, un fallo en reportes
 *   haria fallar la subida de un archivo que no tiene nada que ver.
 * - LIMITE: es un bus en memoria. Si el proceso se cae entre la publicacion y
 *   la entrega al suscriptor, el evento se pierde. La durabilidad la aporta la
 *   cola asincrona del paquete 4.1; hasta entonces, el estado `recibida` de la
 *   entrega en base de datos es lo que permite reprocesar lo que se perdiera.
 */
@Injectable()
export class BusDeEventos {
  private readonly logger = new Logger('BusDeEventos');
  private readonly manejadores = new Map<string, Set<ManejadorDeEvento<unknown>>>();

  suscribir<T>(nombre: string, manejador: ManejadorDeEvento<T>): () => void {
    const conjunto = this.manejadores.get(nombre) ?? new Set();
    conjunto.add(manejador as ManejadorDeEvento<unknown>);
    this.manejadores.set(nombre, conjunto);
    return () => conjunto.delete(manejador as ManejadorDeEvento<unknown>);
  }

  publicar<T>(evento: DomainEvent<T>): void {
    for (const manejador of this.manejadores.get(evento.name) ?? []) {
      setImmediate(() => {
        void this.entregar(manejador, evento);
      });
    }
  }

  private async entregar(
    manejador: ManejadorDeEvento<unknown>,
    evento: DomainEvent<unknown>,
  ): Promise<void> {
    try {
      await manejador(evento);
    } catch (e) {
      this.logger.error(
        JSON.stringify({
          level: 'error',
          eventType: 'suscriptor_fallido',
          evento: evento.name,
          detalle: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }
}

@Global()
@Module({ providers: [BusDeEventos], exports: [BusDeEventos] })
export class EventosModule {}
