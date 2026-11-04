import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Consentimiento } from './entities/consentimiento.entity.js';
import {
  CATALOGO,
  OrigenDelConsentimiento,
  permisoDelCatalogo,
  TipoDeConsentimiento,
  VERSION_DEL_AVISO,
  type PermisoDelCatalogo,
} from './dominio/consentimiento.js';

/** Lo que el titular autoriza ahora mismo, con el texto que leyo. */
export interface EstadoDeUnPermiso extends PermisoDelCatalogo {
  concedido: boolean;
  /** Cuando lo decidio. Null si nunca lo decidio y vale el valor por omision. */
  decididoEn: Date | null;
  /** Que version del aviso acepto. Null si nunca decidio. */
  versionDelAviso: string | null;
  /** Si lo que vale es el valor por omision y no una decision suya. */
  porOmision: boolean;
}

export interface ResultadoDeDecisiones {
  /** Cuantas decisiones cambiaron de verdad. Las repetidas no se guardan. */
  registradas: number;
  permisos: EstadoDeUnPermiso[];
}

/**
 * El registro de consentimientos del titular (pantallas B12 y B24).
 *
 * QUE HACE Y QUE NO HACE
 *
 * Guarda y sirve lo que cada persona autoriza, con su historial. **No hace
 * cumplir nada**, y eso va dicho en la respuesta —cada permiso lleva
 * `vigilado: false`— en vez de callado: las cuatro funciones que estos
 * permisos gobiernan (proctoring, banco de talento, Mentor IA) no existen
 * todavia, y la cuarta espera la decision de la contradiccion §6.9. Una
 * pantalla que promete control sobre algo que nadie vigila es peor que no
 * prometerlo, asi que el backend lo declara en lugar de simularlo.
 *
 * TODO ES SOBRE UNO MISMO
 *
 * Ningun metodo recibe el identificador de otra persona: el usuario sale
 * siempre del token. No hay IDOR posible aqui porque no hay identificador en
 * la peticion que un atacante pueda cambiar.
 */
@Injectable()
export class ConsentimientosService {
  private readonly logger = new Logger('Consentimientos');

  constructor(
    @InjectRepository(Consentimiento)
    private readonly consentimientos: Repository<Consentimiento>,
  ) {}

  /**
   * El catalogo con el estado de cada permiso para esta persona.
   *
   * Devuelve SIEMPRE los cuatro, decididos o no: la pantalla tiene que poder
   * pintar los cuatro interruptores sin saber cuales se guardaron alguna vez.
   */
  async mios(idUsuario: string): Promise<EstadoDeUnPermiso[]> {
    const ultimas = await this.ultimaDecisionPorTipo(idUsuario);

    return CATALOGO.map((permiso) => {
      const decision = ultimas.get(permiso.tipo);
      return {
        ...permiso,
        concedido: decision ? decision.concedido : permiso.porOmision,
        decididoEn: decision ? decision.registradoEn : null,
        versionDelAviso: decision ? decision.versionDelAviso : null,
        porOmision: decision === undefined,
      };
    });
  }

  /**
   * Registra decisiones. Las que no cambian nada no se guardan.
   *
   * POR QUE NO SE GUARDA UNA FILA POR ENVIO
   *
   * La pantalla de privacidad manda el estado completo cada vez que se toca un
   * interruptor. Guardar todo dejaria cien filas identicas y la pregunta que
   * esta tabla existe para responder —"desde cuando autoriza esto"— se volveria
   * mas dificil, no mas facil. Solo se guarda el cambio.
   *
   * SE GUARDAN EN UNA SOLA TRANSACCION
   *
   * B12 manda las tres decisiones juntas y son un solo acto de voluntad: media
   * pantalla guardada seria un consentimiento que la persona nunca dio asi.
   */
  async registrar(
    idUsuario: string,
    decisiones: ReadonlyMap<TipoDeConsentimiento, boolean>,
    origen: OrigenDelConsentimiento,
  ): Promise<ResultadoDeDecisiones> {
    const ultimas = await this.ultimaDecisionPorTipo(idUsuario);

    const nuevas = [...decisiones.entries()]
      .filter(([tipo, concedido]) => {
        const anterior = ultimas.get(tipo);
        if (anterior === undefined) return true;
        // Tambien se guarda si el texto cambio: aceptar la version nueva es
        // una decision distinta aunque el interruptor quede igual.
        return anterior.concedido !== concedido || anterior.versionDelAviso !== VERSION_DEL_AVISO;
      })
      .map(([tipo, concedido]) =>
        this.consentimientos.create({
          idUsuario,
          tipo,
          concedido,
          versionDelAviso: VERSION_DEL_AVISO,
          origen,
        }),
      );

    if (nuevas.length > 0) {
      await this.consentimientos.save(nuevas);
      // Sin el valor de cada permiso: que alguien revoque la biometria es un
      // dato suyo, y los logs los lee mas gente que la base de datos.
      this.registrarEnLog('consentimientos_actualizados', idUsuario, {
        cuantos: nuevas.length,
        origen,
      });
    }

    return { registradas: nuevas.length, permisos: await this.mios(idUsuario) };
  }

  /**
   * Si esta persona autoriza esta finalidad ahora mismo.
   *
   * Existe para cuando alguna de las cuatro funciones se construya: hoy no la
   * llama nadie, y por eso ningun permiso esta `vigilado`. Se deja escrita
   * aqui para que el dia que haga falta no se consulte la tabla a mano desde
   * otro modulo.
   */
  async autoriza(idUsuario: string, tipo: TipoDeConsentimiento): Promise<boolean> {
    const ultimas = await this.ultimaDecisionPorTipo(idUsuario, [tipo]);
    return ultimas.get(tipo)?.concedido ?? permisoDelCatalogo(tipo).porOmision;
  }

  /**
   * Quienes AUTORIZAN hoy esta finalidad por una decision explicita.
   *
   * Solo cuenta a quien decidio: no a quien «vale el valor inicial». Es lo que
   * hace falta para las finalidades que nacen apagadas (el perfil publico); para
   * una que nace encendida, quien nunca decidio tambien autoriza y esta lista
   * se quedaria corta, asi que se rechaza en vez de dar una respuesta enganosa.
   */
  async idsQueAutorizan(tipo: TipoDeConsentimiento): Promise<string[]> {
    if (permisoDelCatalogo(tipo).porOmision) {
      throw new Error(`"${tipo}" nace concedido: listar a quien decidio no basta`);
    }
    const filas = await this.consentimientos
      .createQueryBuilder('c')
      .select('c.idUsuario', 'idUsuario')
      .addSelect('c.concedido', 'concedido')
      .distinctOn(['c.idUsuario'])
      .where('c.tipo = :tipo', { tipo })
      .orderBy('c.idUsuario')
      .addOrderBy('c.registradoEn', 'DESC')
      .getRawMany<{ idUsuario: string; concedido: boolean }>();
    return filas.filter((f) => f.concedido).map((f) => f.idUsuario);
  }

  /** El historial completo, en orden. Lo que B24 llama "descargar mis datos". */
  async historial(idUsuario: string): Promise<Consentimiento[]> {
    return this.consentimientos.find({
      where: { idUsuario },
      order: { registradoEn: 'ASC' },
    });
  }

  /**
   * La ultima decision de cada tipo.
   *
   * Se trae el historial del usuario y se queda con la ultima de cada tipo en
   * memoria. Son cuatro tipos y unas pocas filas por persona; un `DISTINCT ON`
   * seria mas elegante en SQL y menos legible aqui, sin ganar nada a esta
   * escala. Si algun dia una persona acumula cientos de cambios, la consulta
   * sigue siendo una sola y ordenada por el indice.
   */
  private async ultimaDecisionPorTipo(
    idUsuario: string,
    tipos?: readonly TipoDeConsentimiento[],
  ): Promise<Map<TipoDeConsentimiento, Consentimiento>> {
    const filas = await this.consentimientos.find({
      where: tipos ? { idUsuario, tipo: In([...tipos]) } : { idUsuario },
      order: { registradoEn: 'ASC' },
    });

    const ultimas = new Map<TipoDeConsentimiento, Consentimiento>();
    for (const fila of filas) ultimas.set(fila.tipo, fila);
    return ultimas;
  }

  private registrarEnLog(eventType: string, idUsuario: string, metadata: object): void {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        eventType,
        userId: idUsuario,
        metadata,
      }),
    );
  }
}
