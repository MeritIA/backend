import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Evaluacion } from '../entities/evaluacion.entity.js';
import { CalificacionCriterio } from '../entities/calificacion-criterio.entity.js';
import { EVALUACION_FINALIZADA, type EventoEvaluacionFinalizada } from '../dominio/eventos.js';
import {
  EvaluacionNoReintentableError,
  type Evaluador,
  type TrabajoDeEvaluacion,
} from './evaluador.js';
import { ClienteServicioIa, type PeticionDeEvaluacion } from './cliente-servicio-ia.js';
import { EntregaIlegibleError, extraerTexto } from './extraer-texto.js';
import { BusDeEventos } from '../../../common/events/index.js';
import { AlmacenamientoService } from '../../../common/almacenamiento/index.js';
import { EntregasService } from '../../entregas/index.js';
import { EjerciciosService } from '../../ejercicios/index.js';
import { VacantesService } from '../../vacantes/index.js';

/**
 * Orquestacion de la evaluacion (paquete 4.5).
 *
 * Implementa el puerto que ya consume la cola del paquete 4.1, de modo que los
 * reintentos, el tiempo maximo y los estados de la entrega siguen siendo de
 * ella. Aqui solo esta el "que": armar el envio, llamar al servicio de IA y
 * guardar el resultado.
 *
 * EL RECORRIDO
 *
 *  1. Datos de la entrega y de su vacante (por las puertas de esos modulos).
 *  2. Descarga del archivo y **extraccion del texto en el backend**: el
 *     servicio de IA no procesa archivos no confiables (decision del equipo,
 *     2026-09-23). Si el formato no se puede leer, la entrega falla con un
 *     motivo entendible y no se reintenta.
 *  3. Rubrica VIGENTE del ejercicio, y se guarda con que version se califico.
 *  4. Llamada al servicio de IA, cuya respuesta se valida antes de persistir.
 *  5. Guardado en una transaccion y evento para reportes, despues del commit.
 *
 * Ningun otro modulo invoca al servicio de IA, que es el primer criterio de
 * aceptacion del paquete.
 */
@Injectable()
export class EvaluadorQuePersiste implements Evaluador {
  private readonly logger = new Logger('Evaluacion');

  constructor(
    @InjectRepository(Evaluacion) private readonly evaluaciones: Repository<Evaluacion>,
    private readonly dataSource: DataSource,
    private readonly cliente: ClienteServicioIa,
    private readonly entregas: EntregasService,
    private readonly ejercicios: EjerciciosService,
    private readonly vacantes: VacantesService,
    private readonly almacen: AlmacenamientoService,
    private readonly bus: BusDeEventos,
  ) {}

  async evaluar(trabajo: TrabajoDeEvaluacion, senal: AbortSignal): Promise<void> {
    // Idempotencia: si ya se guardo, no se paga otra llamada al modelo.
    if (await this.evaluaciones.exists({ where: { idEntrega: trabajo.idEntrega } })) {
      this.registrar('log', 'evaluacion_ya_existente', { idEntrega: trabajo.idEntrega });
      return;
    }

    const version = await this.ejercicios.versionVigenteDe(trabajo.idEjercicio);
    if (!version) {
      // Sin rubrica no hay contra que calificar, y reintentar no la crea.
      throw new EvaluacionNoReintentableError(
        'El ejercicio no tiene una version vigente con rubrica.',
      );
    }

    const idEmpresa = await this.vacantes.empresaDeLaVacante(trabajo.idVacante);
    if (!idEmpresa) {
      throw new EvaluacionNoReintentableError('La vacante de la entrega ya no existe.');
    }

    const archivos = await this.textoDeLaEntrega(trabajo.idEntrega);

    const idEvaluacion = randomUUID();
    const peticion: PeticionDeEvaluacion = {
      idEvaluacion,
      enunciado: version.enunciado,
      criterios: version.criterios.map((c) => ({
        nombre: c.nombre,
        descripcion: c.descripcion,
        peso: c.peso,
        escalaMaxima: c.escalaMaxima,
      })),
      archivos,
    };

    const resultado = await this.cliente.evaluar(peticion, senal);

    await this.dataSource.transaction(async (manager) => {
      const evaluacion = await manager.save(
        manager.create(Evaluacion, {
          id: idEvaluacion,
          idEntrega: trabajo.idEntrega,
          idVacante: trabajo.idVacante,
          idCandidato: trabajo.idCandidato,
          idEmpresa,
          idEjercicio: trabajo.idEjercicio,
          idVersion: version.idVersion,
          notaFinal: resultado.notaFinal,
          proveedor: resultado.proveedor,
          modelo: resultado.modelo,
          archivos: archivos.length,
          riesgoInyeccion: resultado.seguridad.riesgo,
          puntajeInyeccion: resultado.seguridad.puntaje,
          banderas: resultado.seguridad.banderas.map((b) => ({ ...b })),
          versionReglas: resultado.seguridad.versionReglas,
          versionListaNegra: resultado.seguridad.versionListaNegra,
          // Prueba de que se envio exactamente ese texto, sin duplicarlo.
          textoSha256: createHash('sha256')
            .update(archivos.map((a) => `${a.ruta}\n${a.contenido}`).join('\n'))
            .digest('hex'),
        }),
      );

      await manager.save(
        resultado.criterios.map((c, orden) =>
          manager.create(CalificacionCriterio, {
            idEvaluacion: evaluacion.id,
            orden,
            criterio: c.criterio,
            puntaje: c.puntaje,
            escalaMaxima: c.escalaMaxima,
            peso: c.peso,
            evidencia: c.evidencia,
          }),
        ),
      );
    });

    this.registrar('log', 'evaluacion_persistida', {
      idEvaluacion,
      idEntrega: trabajo.idEntrega,
      idVersion: version.idVersion,
      notaFinal: resultado.notaFinal,
      proveedor: resultado.proveedor,
      modelo: resultado.modelo,
      riesgoInyeccion: resultado.seguridad.riesgo,
      banderas: resultado.seguridad.banderas.length,
    });

    // Despues del commit: reportes no debe buscar una fila que aun no existe.
    this.bus.publicar<EventoEvaluacionFinalizada>({
      name: EVALUACION_FINALIZADA,
      occurredAt: new Date(),
      payload: {
        idEvaluacion,
        idEntrega: trabajo.idEntrega,
        idVacante: trabajo.idVacante,
        idCandidato: trabajo.idCandidato,
        idEmpresa,
        notaFinal: resultado.notaFinal,
      },
    });
  }

  /**
   * Descarga el archivo y lo convierte en texto.
   *
   * Un archivo ilegible no es un fallo del servicio de IA: es una entrega que
   * no se puede evaluar. Se traduce a un error no reintentable para que la
   * cola no gaste intentos en algo que no va a cambiar.
   */
  private async textoDeLaEntrega(
    idEntrega: string,
  ): Promise<{ ruta: string; contenido: string }[]> {
    const referencia = await this.entregas.referenciaDe(idEntrega);
    const contenido = await this.almacen.descargar(referencia);

    try {
      return [...(await extraerTexto(contenido, referencia.nombreOriginal))];
    } catch (e) {
      if (e instanceof EntregaIlegibleError) {
        this.registrar('warn', 'entrega_ilegible', { idEntrega, motivo: e.motivo });
        throw new EvaluacionNoReintentableError(e.message);
      }
      throw e;
    }
  }

  private registrar(nivel: 'log' | 'warn', eventType: string, metadata: object): void {
    this.logger[nivel](
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: nivel === 'log' ? 'info' : 'warn',
        eventType,
        metadata,
      }),
    );
  }
}
