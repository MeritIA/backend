import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SaludService } from '../../../common/salud/index.js';
import { EvaluacionNoReintentableError, ServicioDeIaNoDisponibleError } from './evaluador.js';

/**
 * Cliente HTTP del servicio de IA (paquete 4.4), visto desde el backend.
 *
 * Es el unico sitio del monolito que conoce la direccion y la clave del
 * servicio, y el criterio del paquete 4.5 dice que solo evaluacion puede
 * hablar con el.
 *
 * NO SE CONFIA EN SU RESPUESTA. El servicio esta expuesto a contenido de
 * candidatos: lo que devuelva se valida aqui antes de tocar la base de datos.
 */

/** Lo que se le envia. Coincide con su contrato (docs/contrato.md del servicio). */
export interface PeticionDeEvaluacion {
  readonly idEvaluacion: string;
  readonly enunciado: string;
  readonly criterios: readonly {
    readonly nombre: string;
    readonly descripcion: string;
    readonly peso: number;
    readonly escalaMaxima: number;
  }[];
  readonly archivos: readonly { readonly ruta: string; readonly contenido: string }[];
}

export interface CalificacionRecibida {
  readonly criterio: string;
  readonly puntaje: number;
  readonly escalaMaxima: number;
  readonly peso: number;
  readonly evidencia: string;
}

/** Analisis anti inyeccion que hace el servicio de IA (paquete 4.2). */
export interface SeguridadRecibida {
  readonly riesgo: 'ninguno' | 'bajo' | 'medio' | 'alto';
  readonly puntaje: number;
  readonly banderas: readonly {
    readonly codigo: string;
    readonly archivo: string;
    readonly ocurrencias: number;
  }[];
  readonly versionReglas: string;
  readonly versionListaNegra: string;
}

export interface RespuestaDeEvaluacion {
  readonly idEvaluacion: string;
  readonly notaFinal: number;
  readonly criterios: readonly CalificacionRecibida[];
  readonly proveedor: string;
  readonly modelo: string;
  readonly seguridad: SeguridadRecibida;
}

const TIEMPO_POR_OMISION_MS = 120_000;

@Injectable()
export class ClienteServicioIa implements OnModuleInit {
  private readonly logger = new Logger('ServicioIA');
  private readonly url: string | undefined;
  private readonly clave: string | undefined;
  private readonly tiempoMaximoMs: number;

  constructor(
    config: ConfigService,
    private readonly salud: SaludService,
  ) {
    this.url = config.get<string>('AI_SERVICE_URL')?.replace(/\/+$/, '');
    this.clave = config.get<string>('AI_SERVICE_API_KEY');
    this.tiempoMaximoMs =
      Number(config.get<number>('AI_REQUEST_TIMEOUT_MS')) || TIEMPO_POR_OMISION_MS;
  }

  /**
   * Paquete 5.5: el servicio de IA es la cuarta dependencia del criterio, y se
   * comprueba "con timeout controlado", como pide el Plan de Seguridad §9.
   *
   * NO es critica: sin servicio de IA se siguen recibiendo entregas y la cola
   * las evaluara cuando vuelva. Marcarla critica apagaria el backend entero
   * por algo de lo que el candidato no depende para entregar.
   */
  onModuleInit(): void {
    this.salud.registrar('servicio_ia', false, async () => {
      if (!this.url) {
        return { estado: 'sin_configurar', detalle: 'falta AI_SERVICE_URL' };
      }
      const respuesta = await fetch(`${this.url}/api/salud`, {
        signal: AbortSignal.timeout(2000),
      });
      return respuesta.ok
        ? { estado: 'ok' }
        : { estado: 'caido', detalle: `respondio ${respuesta.status}` };
    });
  }

  /** Si el servicio esta configurado. Sin esto, la cola falla con un motivo claro. */
  get configurado(): boolean {
    return Boolean(this.url && this.clave);
  }

  async evaluar(
    peticion: PeticionDeEvaluacion,
    senal: AbortSignal,
  ): Promise<RespuestaDeEvaluacion> {
    if (!this.url || !this.clave) {
      throw new ServicioDeIaNoDisponibleError(
        'El servicio de IA no esta configurado: faltan AI_SERVICE_URL o AI_SERVICE_API_KEY.',
      );
    }

    // Dos cortes: el de la cola (senal) y el propio, por si la senal no llega.
    const propio = AbortSignal.timeout(this.tiempoMaximoMs);
    const senalCombinada = AbortSignal.any([senal, propio]);

    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.url}/api/v1/evaluaciones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.clave}`,
        },
        body: JSON.stringify(peticion),
        signal: senalCombinada,
      });
    } catch (e) {
      // Red caida, DNS, o tiempo agotado: transitorio. Se registra la CAUSA
      // (el codigo de errno de Node) porque sin ella un fallo de red es
      // indistinguible de otro: "TypeError" a secas no dice si fue el puerto,
      // el DNS o el certificado.
      const causa = e instanceof Error && e.cause instanceof Error ? e.cause : undefined;
      const detalle = [
        e instanceof Error ? e.name : 'error de red',
        (causa as { code?: string } | undefined)?.code ?? causa?.message,
      ]
        .filter(Boolean)
        .join(': ');
      throw new ServicioDeIaNoDisponibleError(
        `No se pudo contactar al servicio de IA en ${this.url}: ${detalle}.`,
      );
    }

    if (!respuesta.ok) throw await this.traducirError(respuesta);

    const cuerpo: unknown = await respuesta.json().catch(() => null);
    return this.validar(cuerpo, peticion);
  }

  /**
   * Traduce el error del servicio usando su campo `reintentable`.
   *
   * Es justo para lo que existe ese campo: la cola no tiene que adivinar si
   * repetir la llamada gasta cuota del proveedor para nada.
   */
  private async traducirError(respuesta: Response): Promise<Error> {
    const cuerpo = (await respuesta.json().catch(() => null)) as {
      codigo?: unknown;
      reintentable?: unknown;
      referencia?: unknown;
    } | null;

    const codigo = typeof cuerpo?.codigo === 'string' ? cuerpo.codigo : 'SIN_CODIGO';
    this.logger.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        eventType: 'servicio_ia_rechazo',
        metadata: { estado: respuesta.status, codigo, referencia: cuerpo?.referencia ?? null },
      }),
    );

    const reintentable =
      typeof cuerpo?.reintentable === 'boolean'
        ? cuerpo.reintentable
        : // Sin el campo: los 5xx se reintentan, los 4xx no.
          respuesta.status >= 500;

    const mensaje = `El servicio de IA respondio ${respuesta.status} (${codigo}).`;
    return reintentable
      ? new ServicioDeIaNoDisponibleError(mensaje)
      : new EvaluacionNoReintentableError(mensaje);
  }

  /**
   * Comprueba que la respuesta es lo que dice ser.
   *
   * El servicio ya valida la salida del modelo, pero el backend no se fia de
   * un componente que habla con contenido de candidatos: si viniera
   * manipulado, esto es lo que impide que llegue a la base.
   */
  private validar(cuerpo: unknown, peticion: PeticionDeEvaluacion): RespuestaDeEvaluacion {
    const invalido = (detalle: string) =>
      new EvaluacionNoReintentableError(`Respuesta invalida del servicio de IA: ${detalle}.`);

    if (typeof cuerpo !== 'object' || cuerpo === null) throw invalido('no es un objeto');
    const r = cuerpo as Record<string, unknown>;

    if (r.idEvaluacion !== peticion.idEvaluacion) {
      throw invalido('el identificador no corresponde a la peticion');
    }
    if (typeof r.notaFinal !== 'number' || !Number.isFinite(r.notaFinal)) {
      throw invalido('la nota no es un numero');
    }
    if (r.notaFinal < 0 || r.notaFinal > 100) throw invalido('la nota esta fuera de 0-100');
    if (typeof r.proveedor !== 'string' || typeof r.modelo !== 'string') {
      throw invalido('faltan proveedor o modelo');
    }
    if (!Array.isArray(r.criterios) || r.criterios.length !== peticion.criterios.length) {
      throw invalido('el numero de criterios no corresponde a la rubrica');
    }

    const porNombre = new Map(peticion.criterios.map((c) => [c.nombre, c]));
    const criterios = r.criterios.map((item: unknown): CalificacionRecibida => {
      if (typeof item !== 'object' || item === null) throw invalido('un criterio no es un objeto');
      const c = item as Record<string, unknown>;

      const esperado = typeof c.criterio === 'string' ? porNombre.get(c.criterio) : undefined;
      if (!esperado) throw invalido('un criterio no esta en la rubrica enviada');
      if (typeof c.puntaje !== 'number' || !Number.isFinite(c.puntaje)) {
        throw invalido(`el puntaje de "${esperado.nombre}" no es un numero`);
      }
      if (c.puntaje < 0 || c.puntaje > esperado.escalaMaxima) {
        throw invalido(`el puntaje de "${esperado.nombre}" sale de su escala`);
      }
      if (typeof c.evidencia !== 'string' || c.evidencia.trim() === '') {
        throw invalido(`falta la evidencia de "${esperado.nombre}"`);
      }

      return {
        criterio: esperado.nombre,
        puntaje: c.puntaje,
        // La escala y el peso se toman de NUESTRA rubrica, no de la respuesta:
        // son los que decidieron el reclutador y el ejercicio.
        escalaMaxima: esperado.escalaMaxima,
        peso: esperado.peso,
        evidencia: c.evidencia.trim(),
      };
    });

    if (new Set(criterios.map((c) => c.criterio)).size !== criterios.length) {
      throw invalido('hay criterios repetidos');
    }

    return {
      idEvaluacion: peticion.idEvaluacion,
      notaFinal: r.notaFinal,
      criterios,
      proveedor: r.proveedor,
      modelo: r.modelo,
      seguridad: this.validarSeguridad(r.seguridad),
    };
  }

  /**
   * Comprueba el analisis anti inyeccion que viene del servicio.
   *
   * Si no viene —un servicio desplegado por detras del backend— NO se pierde
   * la evaluacion: se guarda con version 'ausente', que deja constancia de
   * que esa entrega no paso por la deteccion. Mentir con "ninguno" a secas
   * seria peor: nadie podria distinguir "no habia indicios" de "no se miro".
   */
  private validarSeguridad(bruto: unknown): SeguridadRecibida {
    const RIESGOS = ['ninguno', 'bajo', 'medio', 'alto'] as const;
    const ausente: SeguridadRecibida = {
      riesgo: 'ninguno',
      puntaje: 0,
      banderas: [],
      versionReglas: 'ausente',
      versionListaNegra: 'ausente',
    };

    if (typeof bruto !== 'object' || bruto === null) {
      this.logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warn',
          eventType: 'analisis_de_inyeccion_ausente',
          metadata: { motivo: 'el servicio de IA no devolvio el bloque de seguridad' },
        }),
      );
      return ausente;
    }

    const s = bruto as Record<string, unknown>;
    const riesgo = RIESGOS.find((r) => r === s.riesgo);
    const puntaje = typeof s.puntaje === 'number' && Number.isFinite(s.puntaje) ? s.puntaje : 0;
    const banderas = Array.isArray(s.banderas) ? s.banderas : [];

    return {
      riesgo: riesgo ?? ausente.riesgo,
      puntaje: Math.min(100, Math.max(0, Math.round(puntaje))),
      // Solo los campos conocidos, y recortados: el servicio promete no incluir
      // el texto del candidato, pero esto es lo que lo garantiza aqui.
      banderas: banderas.flatMap((b: unknown) => {
        if (typeof b !== 'object' || b === null) return [];
        const x = b as Record<string, unknown>;
        if (typeof x.codigo !== 'string' || typeof x.archivo !== 'string') return [];
        return [
          {
            codigo: x.codigo.slice(0, 60),
            archivo: x.archivo.slice(0, 500),
            ocurrencias: typeof x.ocurrencias === 'number' ? Math.round(x.ocurrencias) : 1,
          },
        ];
      }),
      versionReglas: typeof s.versionReglas === 'string' ? s.versionReglas.slice(0, 20) : 'ausente',
      versionListaNegra:
        typeof s.versionListaNegra === 'string' ? s.versionListaNegra.slice(0, 20) : 'ausente',
    };
  }
}
