import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Aviso } from './entities/aviso.entity.js';
import {
  EstadoDeAviso,
  MINUTOS_PARA_DAR_POR_PERDIDO,
  REINTENTABLES,
  TipoDeAviso,
} from './dominio/estado-aviso.js';
import { avisoDeCierre } from './dominio/plantillas.js';
import { AutenticacionService } from '../autenticacion/index.js';
import { EvaluacionService } from '../evaluacion/index.js';
import {
  EstadoVacante,
  VACANTE_CERRADA,
  VacantesService,
  type EventoVacanteCerrada,
  type Solicitante,
} from '../vacantes/index.js';
import { BusDeEventos } from '../../common/events/index.js';
import { CorreoService } from '../../common/alertas/index.js';

/** Lo que dejo una ronda de avisos. Son cifras: ninguna direccion de correo. */
export interface ResumenDeAvisos {
  readonly idVacante: string;
  /** Candidatos con al menos una entrega evaluada: los que pueden recibir aviso. */
  readonly considerados: number;
  /** Filas creadas en esta ronda. Las demas ya existian de un cierre anterior. */
  readonly nuevos: number;
  readonly enviados: number;
  readonly sinCanal: number;
  readonly fallidos: number;
  /** Ya tenian el aviso enviado y no se volvieron a tocar. */
  readonly yaAvisados: number;
  readonly omitido?: 'vacante_inexistente' | 'vacante_no_cerrada' | 'canal_apagado';
}

/** Una fila, como la ve el reclutador. Sin direcciones de correo: ver el controlador. */
export interface EstadoDeUnAviso {
  readonly idCandidato: string;
  readonly tipo: TipoDeAviso;
  readonly estado: EstadoDeAviso;
  readonly intentos: number;
  readonly enviadoEn: Date | null;
  readonly ultimoError: string | null;
}

interface FilaReclamada {
  id: string;
  id_candidato: string;
}

/**
 * Avisos por correo a los candidatos.
 *
 * DECISION DEL 27/10/2026: cerrar una vacante avisa por correo a quienes
 * participaron (D-10 de la Declaracion de Alcance). Hasta hoy el cierre era
 * silencioso: el candidato tenia que volver a entrar a adivinar si el proceso
 * habia terminado.
 *
 * POR QUE ES UN MODULO Y NO UN METODO EN OTRO SITIO
 *
 * Necesita tres cosas de tres modulos: el titulo de la vacante (vacantes),
 * quien participo (evaluacion) y a que direccion escribir (autenticacion).
 * Vacantes no puede preguntarle a evaluacion —evaluacion ya lo importa, y la
 * vuelta cerraria un ciclo—, y reportes es de solo lectura a proposito
 * (ADR 0010): mandar correo desde ahi le daria efectos al modulo que existe
 * para no tenerlos. Aqui no entra ningun modulo nuevo en el grafo: este es un
 * consumidor final, nadie lo importa.
 *
 * EL INTERRUPTOR, Y POR QUE NO ESTA ENCENDIDO POR DEFECTO
 *
 * `NOTIFICACIONES_A_CANDIDATOS` arranca apagado. No es timidez: SMTP existe hoy
 * en este proyecto para mandar ALERTAS DE SEGURIDAD al equipo (paquete 5.5).
 * Sin interruptor, el dia que alguien configure SMTP para las alertas empezaria
 * a escribirle a candidatos reales de rebote, sin haberlo decidido. Se enciende
 * en el entorno donde el texto del correo este aprobado.
 *
 * Con el canal apagado, las filas SE GUARDAN IGUAL en estado `pendiente`. Asi
 * nadie se pierde: cuando se encienda, el reenvio recoge lo que quedo
 * pendiente. Un aviso que no se registra es un candidato que no se enteraria
 * nunca y de quien nadie sabria que falto avisar.
 */
@Injectable()
export class NotificacionesService implements OnModuleInit {
  private readonly logger = new Logger('Notificaciones');
  private readonly habilitado: boolean;
  private readonly urlPlataforma: string | undefined;

  constructor(
    @InjectRepository(Aviso) private readonly avisos: Repository<Aviso>,
    private readonly vacantes: VacantesService,
    private readonly evaluacion: EvaluacionService,
    private readonly autenticacion: AutenticacionService,
    private readonly correo: CorreoService,
    private readonly bus: BusDeEventos,
    // @Optional() por lo mismo que en CorreoService y AdmisionService: es una
    // comodidad para las pruebas, no una dependencia del contenedor.
    @Optional() env: NodeJS.ProcessEnv = process.env,
  ) {
    this.habilitado = env.NOTIFICACIONES_A_CANDIDATOS === 'true';
    this.urlPlataforma = env.URL_PLATAFORMA?.trim() || undefined;
  }

  onModuleInit(): void {
    this.bus.suscribir<EventoVacanteCerrada>(VACANTE_CERRADA, async (evento) => {
      // El bus ya aisla los fallos del suscriptor: lo que pase aqui no afecta
      // al reclutador que cerro la vacante ni a los demas suscriptores.
      await this.avisarDelCierre(evento.payload.idVacante);
    });
  }

  /**
   * Avisa a quienes participaron de que la vacante se cerro.
   *
   * ES IDEMPOTENTE, y por dos sitios a la vez: la fila unica
   * (vacante, candidato, tipo) impide crear un segundo aviso, y la reserva en
   * estado `enviando` impide que dos rondas simultaneas envien la misma fila.
   * Las dos garantias hacen falta: la primera sola no evita el correo doble
   * cuando el evento llega dos veces casi a la vez.
   *
   * `incluirPerdidos` solo lo pone el reenvio manual: recupera filas que
   * quedaron reservadas por un proceso que murio a mitad. El camino automatico
   * no las toca, porque no puede distinguir "murio" de "lo esta enviando otro
   * ahora mismo".
   */
  async avisarDelCierre(
    idVacante: string,
    opciones: { incluirPerdidos?: boolean } = {},
  ): Promise<ResumenDeAvisos> {
    const datos = await this.vacantes.datosParaNotificar(idVacante);
    if (!datos) return this.nada(idVacante, 'vacante_inexistente');

    // Se comprueba aqui y no se confia en el evento: un reenvio manual puede
    // llegar mucho despues, y avisar de un cierre que ya no es cierto seria
    // decirle al candidato algo falso.
    if (datos.estado !== EstadoVacante.Cerrada) return this.nada(idVacante, 'vacante_no_cerrada');

    const considerados = await this.evaluacion.candidatosConEvaluacionEn(idVacante);
    const nuevos = await this.registrarPendientes(idVacante, considerados);
    const yaAvisados = await this.avisos.count({
      where: { idVacante, tipo: TipoDeAviso.VacanteCerrada, estado: EstadoDeAviso.Enviada },
    });

    if (!this.habilitado) {
      this.registrar('avisos_sin_enviar_canal_apagado', {
        idVacante,
        considerados: considerados.length,
        nuevos,
      });
      return {
        idVacante,
        considerados: considerados.length,
        nuevos,
        enviados: 0,
        sinCanal: 0,
        fallidos: 0,
        yaAvisados,
        omitido: 'canal_apagado',
      };
    }

    const reclamados = await this.reclamar(idVacante, opciones.incluirPerdidos === true);
    const identidades = await this.autenticacion.identidadesDe(
      reclamados.map((f) => f.id_candidato),
    );

    let enviados = 0;
    let sinCanal = 0;
    let fallidos = 0;

    for (const fila of reclamados) {
      const identidad = identidades.get(fila.id_candidato);
      if (!identidad) {
        // El candidato ya no esta. No es un fallo del canal y reintentarlo no
        // va a arreglarlo: se marca y se deja constancia.
        await this.avisos.update(fila.id, {
          estado: EstadoDeAviso.Fallida,
          ultimoError: 'El candidato ya no existe.',
        });
        fallidos += 1;
        continue;
      }

      const texto = avisoDeCierre({
        nombre: identidad.nombre,
        tituloVacante: datos.titulo,
        urlPlataforma: this.urlPlataforma,
      });

      // CorreoService no lanza: devuelve en que quedo. Un buzon lleno no puede
      // dejar sin aviso a los demas candidatos de la lista.
      const resultado = await this.correo.enviarA(identidad.correo, texto.asunto, texto.cuerpo);

      if (resultado === 'enviado') {
        await this.avisos.update(fila.id, {
          estado: EstadoDeAviso.Enviada,
          enviadoEn: new Date(),
          ultimoError: null,
        });
        enviados += 1;
      } else if (resultado === 'sin_canal') {
        await this.avisos.update(fila.id, {
          estado: EstadoDeAviso.SinCanal,
          ultimoError: 'No hay servidor de correo configurado (SMTP_HOST).',
        });
        sinCanal += 1;
      } else {
        await this.avisos.update(fila.id, {
          estado: EstadoDeAviso.Fallida,
          ultimoError: 'El servidor de correo rechazo el envio. El detalle esta en el log.',
        });
        fallidos += 1;
      }
    }

    this.registrar('avisos_de_cierre_procesados', {
      idVacante,
      considerados: considerados.length,
      nuevos,
      enviados,
      sinCanal,
      fallidos,
    });

    return {
      idVacante,
      considerados: considerados.length,
      nuevos,
      enviados,
      sinCanal,
      fallidos,
      yaAvisados,
    };
  }

  /**
   * Lo que se envio de una vacante, para el reclutador que la cerro.
   *
   * `obtenerPara` es lo que protege esto: devuelve 404 si la vacante no es de
   * su empresa, asi que cambiar el identificador en la URL no abre nada.
   */
  async estadoDeLaVacante(idVacante: string, solicitante: Solicitante): Promise<EstadoDeUnAviso[]> {
    await this.vacantes.obtenerPara(idVacante, solicitante);
    const filas = await this.avisos.find({
      where: { idVacante },
      order: { creadoEn: 'ASC' },
    });
    return filas.map((f) => ({
      idCandidato: f.idCandidato,
      tipo: f.tipo,
      estado: f.estado,
      intentos: f.intentos,
      enviadoEn: f.enviadoEn,
      ultimoError: f.ultimoError,
    }));
  }

  /**
   * Reintenta lo que no salio, y crea los avisos de quien se evaluo despues.
   *
   * NO PUEDE REPETIR UN CORREO, y eso no depende de que quien llame tenga
   * cuidado: la reserva solo toma filas que no estan en `enviada`. Es la
   * propiedad que hace que este endpoint sea seguro de apretar dos veces.
   */
  async reenviar(idVacante: string, solicitante: Solicitante): Promise<ResumenDeAvisos> {
    await this.vacantes.obtenerPara(idVacante, solicitante);
    this.registrar('reenvio_de_avisos_solicitado', { idVacante, porUsuario: solicitante.id });
    return this.avisarDelCierre(idVacante, { incluirPerdidos: true });
  }

  /**
   * Crea las filas que falten, en una sola sentencia.
   *
   * `ON CONFLICT DO NOTHING` contra el unico (vacante, candidato, tipo): dos
   * rondas a la vez crean las filas una sola vez, y el RETURNING dice cuantas
   * se crearon de verdad. Hacerlo con un SELECT previo y luego insertar lo que
   * falta dejaria la ventana entre las dos consultas, que es justo donde se
   * cuela el correo duplicado.
   */
  private async registrarPendientes(idVacante: string, candidatos: string[]): Promise<number> {
    if (candidatos.length === 0) return 0;
    // Sin duplicados: la consulta de evaluacion ya devuelve distintos, pero un
    // array con repetidos reventaria contra el indice unico dentro de la misma
    // sentencia, donde ON CONFLICT no ayuda.
    const unicos = [...new Set(candidatos)];

    const creadas = await this.consultar<{ id: string }>(
      `insert into "notificaciones"."avisos" (id_vacante, id_candidato, tipo)
       select $1::uuid, c, $2::"notificaciones"."tipo_de_aviso"
         from unnest($3::uuid[]) as c
       on conflict (id_vacante, id_candidato, tipo) do nothing
       returning id`,
      [idVacante, TipoDeAviso.VacanteCerrada, unicos],
    );

    return creadas.length;
  }

  /**
   * Reserva las filas que se van a enviar en esta ronda.
   *
   * Un UPDATE condicional con RETURNING, que es la version mas corta de "tomar
   * trabajo sin que otro lo tome a la vez": PostgreSQL bloquea cada fila al
   * actualizarla, asi que de dos rondas simultaneas solo una se lleva cada
   * fila. La otra recibe cero y no manda nada.
   */
  private async reclamar(idVacante: string, incluirPerdidos: boolean): Promise<FilaReclamada[]> {
    return this.consultar<FilaReclamada>(
      `update "notificaciones"."avisos"
          set estado = 'enviando', intentos = intentos + 1, actualizado_en = now()
        where id_vacante = $1::uuid
          and tipo = $2::"notificaciones"."tipo_de_aviso"
          and (
            estado = any($3::"notificaciones"."estado_de_aviso"[])
            or (
              $4::boolean
              and estado = 'enviando'
              and actualizado_en < now() - make_interval(mins => $5::int)
            )
          )
       returning id, id_candidato`,
      [
        idVacante,
        TipoDeAviso.VacanteCerrada,
        [...REINTENTABLES],
        incluirPerdidos,
        MINUTOS_PARA_DAR_POR_PERDIDO,
      ],
    );
  }

  /**
   * SQL a pelo, con las filas del RETURNING normalizadas.
   *
   * Hace falta porque TypeORM no devuelve lo mismo en los dos casos: de un
   * INSERT ... RETURNING devuelve las filas, y de un UPDATE ... RETURNING
   * devuelve [filas, numeroDeAfectadas]. Sin normalizarlo, recorrer el
   * resultado de la reserva iteraba sobre un array y un numero, cada "fila"
   * venia sin `id`, y el UPDATE siguiente fallaba con "Empty criteria(s) are
   * not allowed". Lo encontro la prueba de integracion: las filas se quedaban
   * en `enviando` para siempre.
   *
   * Se escribe en SQL y no con el constructor de consultas porque las dos
   * sentencias usan cosas que el ORM no expresa —ON CONFLICT DO NOTHING contra
   * un indice concreto, y un UPDATE condicional con RETURNING— y porque son las
   * dos sentencias de las que depende que nadie reciba un correo repetido: aqui
   * se leen enteras.
   */
  private async consultar<T>(sql: string, parametros: unknown[]): Promise<T[]> {
    const salida: unknown = await this.avisos.query(sql, parametros);
    if (!Array.isArray(salida)) return [];
    const primero: unknown = salida[0];
    return (Array.isArray(primero) ? primero : salida) as T[];
  }

  private nada(idVacante: string, omitido: ResumenDeAvisos['omitido']): ResumenDeAvisos {
    return {
      idVacante,
      considerados: 0,
      nuevos: 0,
      enviados: 0,
      sinCanal: 0,
      fallidos: 0,
      yaAvisados: 0,
      omitido,
    };
  }

  /**
   * Log estructurado, y nunca con la direccion de correo: el log se copia, se
   * manda por chat y se guarda meses. Se registran identificadores y cifras,
   * que es lo que hace falta para auditar un envio.
   */
  private registrar(eventType: string, metadata: object): void {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType,
        metadata,
      }),
    );
  }
}
