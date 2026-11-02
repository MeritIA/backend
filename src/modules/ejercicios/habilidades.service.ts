import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Habilidad } from './entities/habilidad.entity.js';
import { AliasDeHabilidad } from './entities/alias-de-habilidad.entity.js';
import { normalizarNombreDeHabilidad } from './dominio/habilidad.js';
import type { UsuarioAutenticado } from '../autenticacion/index.js';
import type { CrearHabilidadDto, AnadirAliasDto } from './dto/index.js';

/**
 * El vocabulario de habilidades (ADR-0017).
 *
 * Cierra el limite conocido del ADR-0016: sin vocabulario, "Claridad del
 * codigo" y "Legibilidad" eran dos habilidades distintas para el calculo de
 * afinidad, aunque una persona las juntaria.
 *
 * COMO SE USA, Y ES LO IMPORTANTE DE ESTE SERVICIO
 *
 * `resolver()` traduce un nombre de criterio a su clave canonica. Lo llaman el
 * perfil de habilidades y el calculo de afinidad, y los dos tienen que usar la
 * MISMA traduccion: si uno resolviera y el otro no, un criterio contaria para
 * una habilidad al calcular el perfil y para otra al compararlo, y el numero
 * saldria mal sin que nada fallara.
 *
 * DEGRADA, NO ROMPE
 *
 * Un nombre que no esta en el catalogo resuelve a su propia forma normalizada,
 * que es exactamente lo que hacia antes de que el vocabulario existiera. Asi el
 * catalogo se puede empezar vacio y llenar poco a poco, y nada deja de
 * funcionar mientras esta a medias. Es la propiedad que hace que esto se pueda
 * desplegar sin migrar datos.
 */
@Injectable()
export class HabilidadesService {
  private readonly logger = new Logger('Habilidades');

  constructor(
    @InjectRepository(Habilidad) private readonly habilidades: Repository<Habilidad>,
    @InjectRepository(AliasDeHabilidad) private readonly alias: Repository<AliasDeHabilidad>,
    private readonly dataSource: DataSource,
  ) {}

  /** El catalogo completo, con sus alias. Lo lee cualquiera autenticado. */
  async catalogo(incluirRetiradas = false): Promise<Habilidad[]> {
    return this.habilidades.find({
      where: incluirRetiradas ? {} : { activa: true },
      relations: { alias: true },
      order: { nombre: 'ASC' },
    });
  }

  /**
   * Traduce nombres de criterio a claves canonicas.
   *
   * Se pide en lote y se resuelve con DOS consultas, no con una por nombre: una
   * vacante con tres ejercicios de cinco criterios son quince nombres, y un
   * catalogo de afinidad los multiplica por cada oferta.
   *
   * El orden de preferencia es: nombre canonico, luego alias, luego la propia
   * forma normalizada. El canonico primero porque si alguien registro un alias
   * que coincide con un nombre canonico --el servicio lo impide, pero un dato
   * viejo podria-- manda el canonico, que es el que el catalogo muestra.
   */
  async resolver(nombres: readonly string[]): Promise<Map<string, string>> {
    const claves = [...new Set(nombres.map(normalizarNombreDeHabilidad))].filter((c) => c !== '');
    const traduccion = new Map<string, string>();
    if (claves.length === 0) return traduccion;

    // Por omision, cada nombre es su propia habilidad: es el comportamiento de
    // antes del vocabulario, y es lo que hace que degrade en vez de romper.
    for (const clave of claves) traduccion.set(clave, clave);

    const [canonicas, alias] = await Promise.all([
      this.habilidades.find({ where: claves.map((clave) => ({ clave })) }),
      this.alias.find({
        where: claves.map((clave) => ({ clave })),
        relations: { habilidad: true },
      }),
    ]);

    // Los alias primero y las canonicas despues, para que una canonica gane.
    for (const a of alias) {
      if (a.habilidad) traduccion.set(a.clave, a.habilidad.clave);
    }
    for (const h of canonicas) traduccion.set(h.clave, h.clave);

    return traduccion;
  }

  /**
   * Una funcion de traduccion ya resuelta, para pasarsela a un calculo puro.
   *
   * El calculo de afinidad no debe saber que existe una base de datos: recibe
   * esto y la llama. Si un nombre no estaba entre los que se pidieron, cae en su
   * forma normalizada, que es el mismo comportamiento que sin vocabulario.
   */
  async traductorPara(nombres: readonly string[]): Promise<(nombre: string) => string> {
    const traduccion = await this.resolver(nombres);
    return (nombre: string) => {
      const clave = normalizarNombreDeHabilidad(nombre);
      return traduccion.get(clave) ?? clave;
    };
  }

  async crear(datos: CrearHabilidadDto, solicitante: UsuarioAutenticado): Promise<Habilidad> {
    const clave = normalizarNombreDeHabilidad(datos.nombre);
    if (clave === '') {
      throw new BadRequestException(
        'El nombre de la habilidad no puede quedar vacio al normalizarlo.',
      );
    }

    const terminos = (datos.alias ?? []).map((t) => ({
      termino: t,
      clave: normalizarNombreDeHabilidad(t),
    }));

    if (terminos.some((t) => t.clave === '')) {
      throw new BadRequestException('Un alias no puede quedar vacio al normalizarlo.');
    }
    if (terminos.some((t) => t.clave === clave)) {
      throw new BadRequestException(
        'Un alias no puede ser el propio nombre de la habilidad: ya resuelve por si mismo.',
      );
    }
    const repetidos = terminos.map((t) => t.clave);
    if (new Set(repetidos).size !== repetidos.length) {
      throw new BadRequestException('La lista de alias tiene terminos repetidos.');
    }

    await this.exigirQueNoChoque(
      clave,
      terminos.map((t) => t.clave),
    );

    try {
      const habilidad = await this.dataSource.transaction(async (manager) => {
        const creada = await manager.getRepository(Habilidad).save(
          manager.getRepository(Habilidad).create({
            nombre: datos.nombre,
            clave,
            descripcion: datos.descripcion,
            idAutor: solicitante.id,
          }),
        );
        if (terminos.length > 0) {
          await manager
            .getRepository(AliasDeHabilidad)
            .save(
              terminos.map((t) =>
                manager
                  .getRepository(AliasDeHabilidad)
                  .create({ idHabilidad: creada.id, termino: t.termino, clave: t.clave }),
              ),
            );
        }
        return creada;
      });

      this.registrar('habilidad_creada', solicitante, {
        idHabilidad: habilidad.id,
        clave,
        alias: terminos.length,
      });
      return this.obtener(habilidad.id);
    } catch (error) {
      if (esViolacionDeUnicidad(error)) {
        throw new ConflictException(
          'Esa habilidad o uno de sus alias ya existe en el vocabulario.',
        );
      }
      throw error;
    }
  }

  async anadirAlias(
    idHabilidad: string,
    datos: AnadirAliasDto,
    solicitante: UsuarioAutenticado,
  ): Promise<Habilidad> {
    const habilidad = await this.obtener(idHabilidad);
    const clave = normalizarNombreDeHabilidad(datos.termino);
    if (clave === '') {
      throw new BadRequestException('El alias no puede quedar vacio al normalizarlo.');
    }
    if (clave === habilidad.clave) {
      throw new BadRequestException(
        'Ese alias es el propio nombre de la habilidad: ya resuelve por si mismo.',
      );
    }

    await this.exigirQueNoChoque(null, [clave]);

    try {
      await this.alias.save(this.alias.create({ idHabilidad, termino: datos.termino, clave }));
    } catch (error) {
      if (esViolacionDeUnicidad(error)) {
        throw new ConflictException('Ese termino ya es alias de alguna habilidad.');
      }
      throw error;
    }

    this.registrar('alias_anadido', solicitante, { idHabilidad, clave });
    return this.obtener(idHabilidad);
  }

  async quitarAlias(
    idHabilidad: string,
    termino: string,
    solicitante: UsuarioAutenticado,
  ): Promise<Habilidad> {
    const clave = normalizarNombreDeHabilidad(termino);
    const borrado = await this.alias.delete({ idHabilidad, clave });
    if (borrado.affected === 0) {
      throw new NotFoundException('Esa habilidad no tiene ese alias.');
    }
    this.registrar('alias_quitado', solicitante, { idHabilidad, clave });
    return this.obtener(idHabilidad);
  }

  /**
   * Retira una habilidad del catalogo sin borrarla.
   *
   * Sigue resolviendo los nombres que ya se escribieron. Borrarla cambiaria el
   * perfil de los candidatos que ya la tenian, y un perfil que se mueve porque
   * alguien edito un catalogo no es auditable.
   */
  async retirar(id: string, solicitante: UsuarioAutenticado): Promise<Habilidad> {
    const habilidad = await this.obtener(id);
    habilidad.activa = false;
    await this.habilidades.save(habilidad);
    this.registrar('habilidad_retirada', solicitante, { idHabilidad: id });
    return this.obtener(id);
  }

  async obtener(id: string): Promise<Habilidad> {
    const habilidad = await this.habilidades.findOne({
      where: { id },
      relations: { alias: true },
    });
    if (!habilidad) throw new NotFoundException('La habilidad no existe.');
    return habilidad;
  }

  /**
   * La regla que la base NO puede imponer: un alias no puede ser el nombre
   * canonico de otra habilidad, ni al contrario.
   *
   * Un indice unico no abarca dos tablas. Si se permitiera, un mismo nombre
   * resolveria a dos habilidades distintas segun por donde se mirara, y el
   * perfil de un candidato cambiaria sin que nadie tocara sus calificaciones.
   */
  private async exigirQueNoChoque(
    claveCanonica: string | null,
    clavesDeAlias: readonly string[],
  ): Promise<void> {
    if (claveCanonica !== null) {
      const comoAlias = await this.alias.findOne({
        where: { clave: claveCanonica },
        relations: { habilidad: true },
      });
      if (comoAlias) {
        throw new ConflictException(
          `"${claveCanonica}" ya es alias de la habilidad "${comoAlias.habilidad?.nombre ?? '?'}". ` +
            'Un nombre no puede resolver a dos habilidades distintas.',
        );
      }
    }

    for (const clave of clavesDeAlias) {
      const comoCanonica = await this.habilidades.findOne({ where: { clave } });
      if (comoCanonica) {
        throw new ConflictException(
          `"${clave}" ya es el nombre de la habilidad "${comoCanonica.nombre}", asi que no puede ser alias de otra.`,
        );
      }
    }
  }

  private registrar(eventType: string, solicitante: UsuarioAutenticado, metadata: object): void {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'security',
        eventType,
        userId: solicitante.id,
        metadata: { ...metadata, rol: solicitante.rol },
      }),
    );
  }
}

function esViolacionDeUnicidad(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
