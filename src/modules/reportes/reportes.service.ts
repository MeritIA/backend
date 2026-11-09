import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  rankingDeCandidatos,
  resumenDeVacante,
  type EvaluacionParaReporte,
  type FilaDeRanking,
  type ResumenDeVacante,
} from './dominio/consolidar.js';
import { aCsv, type Columna } from './dominio/csv.js';
import { aliasDeCandidato } from './dominio/alias.js';
import { progresoDe, type ProgresoDeVacante } from './dominio/progreso.js';
import { calcularAfinidad, exigenciasDe, type Afinidad } from './dominio/afinidad.js';
import { RevelacionDeIdentidad } from './entities/revelacion-de-identidad.entity.js';
import {
  AutenticacionService,
  ConsentimientosService,
  TipoDeConsentimiento,
  type Identidad,
} from '../autenticacion/index.js';
import { EjerciciosService, HabilidadesService } from '../ejercicios/index.js';
import { EntregasService, EstadoEntrega } from '../entregas/index.js';
import { EvaluacionService } from '../evaluacion/index.js';
import {
  EstadoVacante,
  VacantesService,
  type CalculadorDeAfinidad,
  type OfertaDelCatalogo,
  type Solicitante,
} from '../vacantes/index.js';

/**
 * Servicio de aplicacion del modulo de reportes (paquete 5.1).
 *
 * Es la unica via por la que otro modulo puede interactuar con reportes.
 *
 * ESTE MODULO NO ES DUENO DE NINGUN DATO
 *
 * No tiene entidades, ni repositorios, ni migracion: compone lo que ya existe
 * en evaluacion, entregas, vacantes y autenticacion, cada uno por su puerta
 * publica.
 *
 * El Diccionario de la EDT lista "esquema de reportes" entre los recursos del
 * paquete, asi que esto es una divergencia con el documento, y queda dicha en
 * voz alta en vez de resuelta en silencio. El motivo: una tabla propia seria
 * una copia de las notas, y una copia se desincroniza —un evento perdido, un
 * reinicio a medias— y entonces el reporte contradice a la evaluacion, que es
 * el dato que se puede disputar. Para el MVP no hace falta: el ranking de una
 * vacante son decenas de filas, no millones. Si el piloto pide analitica que no
 * aguante esta via, el paso natural es proyectar por el evento
 * `evaluacion.evaluacion-finalizada`, que el paquete 4.5 ya publica para esto.
 *
 * EL AISLAMIENTO NO SE REIMPLEMENTA AQUI
 *
 * El tercer criterio del paquete —"ningun reporte muestra datos de una empresa
 * distinta a la del reclutador autenticado"— se cumple delegando: toda lectura
 * entra por `obtenerPara` o `deVacante`, que ya exigen el acceso y responden
 * 404. Comprobarlo otra vez aqui crearia un segundo sitio donde la regla puede
 * quedarse vieja.
 */
@Injectable()
export class ReportesService implements OnModuleInit, CalculadorDeAfinidad {
  private readonly logger = new Logger('Reportes');

  constructor(
    @InjectRepository(RevelacionDeIdentidad)
    private readonly revelaciones: Repository<RevelacionDeIdentidad>,
    private readonly evaluacion: EvaluacionService,
    private readonly entregas: EntregasService,
    private readonly vacantes: VacantesService,
    private readonly ejerciciosDelBanco: EjerciciosService,
    private readonly habilidades: HabilidadesService,
    private readonly autenticacion: AutenticacionService,
    private readonly consentimientos: ConsentimientosService,
  ) {}

  /**
   * Uso de cada ejercicio del banco de la empresa (pantalla A10): en cuantas
   * vacantes se usa, cuantas evaluaciones tiene y su nota promedio.
   */
  async usoDeEjercicios(solicitante: Solicitante): Promise<UsoDeEjercicio[]> {
    if (solicitante.idEmpresa === null) {
      throw new BadRequestException(
        'Esta lectura resume el banco de una empresa, y un administrador de plataforma no pertenece a ninguna.',
      );
    }
    const [uso, estadisticas] = await Promise.all([
      this.vacantes.usoDeEjercicios(solicitante.idEmpresa),
      this.evaluacion.estadisticasPorEjercicio(solicitante.idEmpresa),
    ]);
    const ids = new Set([...Object.keys(uso), ...Object.keys(estadisticas)]);
    return [...ids].map((idEjercicio) => ({
      idEjercicio,
      vacantes: uso[idEjercicio] ?? 0,
      evaluaciones: estadisticas[idEjercicio]?.evaluaciones ?? 0,
      notaPromedio: estadisticas[idEjercicio]?.notaPromedio ?? null,
    }));
  }

  /**
   * «Descargar mis datos" (Ley 1581): todo lo que MeritIA guarda de la persona
   * que pregunta, en una sola respuesta.
   *
   * Vive aqui porque reune datos de varios modulos y reportes es el unico que
   * puede componerlos. No recibe identificador: la persona sale del token.
   * Incluye los METADATOS de las entregas (nombre, tamano, huella), no el
   * archivo: ese ya lo tiene la persona y se baja con su enlace.
   */
  async misDatos(solicitante: Solicitante): Promise<DatosPersonales> {
    const [perfil, consentimientos, entregas, evaluaciones, postulaciones] = await Promise.all([
      this.autenticacion.perfilDe(solicitante.id),
      this.consentimientos.historial(solicitante.id),
      this.entregas.mias(solicitante),
      this.evaluacion.mias(solicitante),
      this.vacantes.misPostulaciones(solicitante),
    ]);
    this.registrar('datos_personales_exportados', solicitante, {});
    return {
      generadoEn: new Date(),
      perfil,
      consentimientos: consentimientos.map((c) => ({
        tipo: c.tipo,
        concedido: c.concedido,
        versionDelAviso: c.versionDelAviso,
        origen: c.origen,
        registradoEn: c.registradoEn,
      })),
      entregas: entregas.map((e) => ({
        id: e.id,
        idVacante: e.idVacante,
        idEjercicio: e.idEjercicio,
        numeroIntento: e.numeroIntento,
        estado: e.estado,
        archivoNombre: e.archivoNombre,
        archivoBytes: e.archivoBytes,
        creadaEn: e.creadaEn,
      })),
      evaluaciones: evaluaciones.map((e) => ({
        idEntrega: e.idEntrega,
        notaFinal: e.notaFinal,
        creadaEn: e.creadaEn,
        criterios: e.criterios.map((c) => ({
          criterio: c.criterio,
          puntaje: c.puntaje,
          escalaMaxima: c.escalaMaxima,
          evidencia: c.evidencia,
        })),
      })),
      postulaciones: postulaciones.map((p) => ({
        idVacante: p.idVacante,
        estado: p.estado,
        motivoDelRechazo: p.motivoDelRechazo,
        creadaEn: p.creadaEn,
      })),
    };
  }

  /**
   * El banco de talento: personas que AUTORIZARON mostrar su perfil, con su
   * mejor nota en cualquier vacante.
   *
   * Es la unica lectura que cruza empresas, y por eso es la unica que exige un
   * consentimiento explicito: sin el permiso `perfil_publico` nadie aparece. Va
   * con alias, igual que el ranking; el reclutador que quiera a alguien lo invita
   * a su vacante por el identificador y la identidad sigue el camino de siempre.
   */
  async bancoDeTalento(solicitante: Solicitante): Promise<FilaDeTalento[]> {
    const autorizan = await this.consentimientos.idsQueAutorizan(
      TipoDeConsentimiento.PerfilPublico,
    );
    const resumen = await this.evaluacion.resumenPorCandidato(autorizan);
    this.registrar('banco_de_talento_consultado', solicitante, { personas: resumen.length });
    return resumen
      .map((r) => ({
        idCandidato: r.idCandidato,
        alias: aliasDeCandidato('banco-de-talento', r.idCandidato),
        mejorNota: r.mejorNota,
        evaluaciones: r.evaluaciones,
      }))
      .sort((a, b) => b.mejorNota - a.mejorNota);
  }

  /**
   * El panel de la empresa: las cuatro cifras de la pantalla A02.
   *
   * POR QUE VIVE EN REPORTES
   *
   * Porque ninguna de las cuatro sale de un solo modulo. Vacantes sabe cuantas
   * hay y cuantas personas se contrataron, entregas sabe cuantas estan por
   * evaluar, y ejercicios sabe con cuanto material cuenta el banco. Reportes es
   * el unico modulo autorizado a componer datos de varios, y hacerlo aqui
   * evita que el frontend lo arme con una llamada por vacante, que es como se
   * vuelve lento un panel.
   *
   * NO RECIBE NINGUN IDENTIFICADOR, Y ESO ES LA PROTECCION
   *
   * La empresa sale del token de quien pregunta, no de la URL. No hay nada que
   * cambiar en la peticion para ver el panel de otra empresa: la clase de
   * ataque que el encuadre llama IDOR no tiene superficie aqui.
   */
  /**
   * Se registra en `vacantes` como quien sabe calcular la afinidad.
   *
   * La invitacion automatica decide al postularse, y eso pasa en `vacantes`,
   * que no puede pedirle nada a `reportes` sin crear un ciclo. Asi que la
   * llamada va al reves: aqui nos ofrecemos. Mismo momento en el que
   * `notificaciones` se suscribe al bus.
   */
  onModuleInit(): void {
    this.vacantes.registrarCalculadorDeAfinidad(this);
  }

  /**
   * El % de afinidad de un candidato con UNA vacante.
   *
   * Lo consume la invitacion automatica, de forma sincrona dentro de la
   * peticion del candidato. Devuelve `null` si no hay evidencia sobre lo que
   * esa vacante pide, y quien lo llama trata ese `null` como "que lo vea una
   * persona", nunca como un rechazo.
   */
  async porcentajeDe(idCandidato: string, idVacante: string): Promise<number | null> {
    const rubricas = await this.vacantes.rubricasDeVacantesPublicadas([idVacante]);
    const deLaVacante = rubricas.get(idVacante) ?? [];
    if (deLaVacante.length === 0) return null;

    const [perfil, traducir] = await Promise.all([
      this.evaluacion.perfilDeHabilidades(idCandidato),
      this.habilidades.traductorPara(deLaVacante.flat().map((c) => c.nombre)),
    ]);

    return calcularAfinidad(exigenciasDe(deLaVacante, traducir), perfil, traducir).porcentaje;
  }

  /**
   * El catalogo abierto con el % de afinidad de quien pregunta (B13).
   *
   * POR QUE VIVE EN REPORTES Y NO EN VACANTES
   *
   * No es gusto: es la unica opcion. La afinidad necesita datos de `evaluacion`
   * y `evaluacion` ya depende de `vacantes`, asi que calcularla dentro del
   * catalogo crearia un ciclo entre modulos. Reportes es el sitio que compone
   * entre modulos sin ser dueno de nada (ADR-0010), y el catalogo se le pide a
   * `vacantes` en vez de reescribirlo aqui: una sola definicion de "oferta
   * abierta".
   *
   * UNA SOLA LLAMADA, COMO EL PANEL
   *
   * El perfil del candidato se lee UNA VEZ y se compara contra todas las
   * ofertas. Pedir la afinidad oferta por oferta serian veinte consultas para
   * pintar una lista.
   *
   * LA AFINIDAD ORDENA, NUNCA ESCONDE
   *
   * Devuelve el catalogo COMPLETO, incluidas las ofertas con afinidad `null`.
   * Esto es la decision mas importante de todo el calculo y esta en el
   * ADR-0016: un algoritmo que decide que ofertas ve una persona es exactamente
   * el sesgo que la auditoria de equidad existe para vigilar. Un numero que
   * informa y se puede discutir no lo es. Hay una prueba que lo fija.
   *
   * Y quien no tiene evidencia sale al principio, no al final: es quien mas
   * necesita encontrar su primera prueba.
   */
  async catalogoConAfinidad(solicitante: Solicitante): Promise<OfertaConAfinidad[]> {
    const ofertas = await this.vacantes.catalogoAbierto(solicitante);
    if (ofertas.length === 0) return [];

    const [perfil, rubricas] = await Promise.all([
      this.evaluacion.perfilDeHabilidades(solicitante.id),
      this.vacantes.rubricasDeVacantesPublicadas(ofertas.map((o) => o.id)),
    ]);

    // UN SOLO traductor para todas las ofertas, y el mismo que uso el perfil.
    // Si el perfil tradujera y la comparacion no, un criterio contaria para una
    // habilidad al agrupar y para otra al comparar: el numero saldria mal sin
    // que nada fallara, que es el peor tipo de fallo.
    const traducir = await this.habilidades.traductorPara(
      [...rubricas.values()].flat(2).map((c) => c.nombre),
    );

    const conAfinidad = ofertas.map((oferta) => ({
      ...oferta,
      afinidad: calcularAfinidad(
        exigenciasDe(rubricas.get(oferta.id) ?? [], traducir),
        perfil,
        traducir,
      ),
    }));

    this.registrar('catalogo_con_afinidad_consultado', solicitante, {
      ofertas: conAfinidad.length,
      habilidadesEnElPerfil: perfil.size,
    });

    // Mayor afinidad primero. Las desconocidas van arriba y no abajo: quien no
    // tiene ninguna prueba hecha es quien mas necesita ver ofertas, y hundirlo
    // al final seria castigarle por no haber empezado.
    return conAfinidad.sort((a, b) => {
      const sinA = a.afinidad.porcentaje === null;
      const sinB = b.afinidad.porcentaje === null;
      if (sinA !== sinB) return sinA ? -1 : 1;
      return (b.afinidad.porcentaje ?? 0) - (a.afinidad.porcentaje ?? 0);
    });
  }

  /**
   * El perfil de habilidades del propio candidato (B13).
   *
   * Solo para si mismo. Ninguna empresa lo ve: lo que una empresa ve de un
   * candidato es su desglose en SU vacante, no lo que demostro en las de la
   * competencia.
   */
  async miPerfilDeHabilidades(solicitante: Solicitante): Promise<HabilidadDelPerfil[]> {
    const perfil = await this.evaluacion.perfilDeHabilidades(solicitante.id);
    return [...perfil.values()]
      .map((h) => ({
        nombre: h.nombre,
        nivel: Math.round(h.nivel * 1000) / 10,
        veces: h.veces,
      }))
      .sort((a, b) => b.nivel - a.nivel);
  }

  async panelDeLaEmpresa(solicitante: Solicitante): Promise<PanelDeEmpresa> {
    if (solicitante.idEmpresa === null) {
      // Un administrador de plataforma no tiene empresa. Devolver un panel
      // vacio seria peor que decirlo: parecería una empresa sin actividad.
      throw new BadRequestException(
        'Este panel resume una empresa, y un administrador de plataforma no pertenece a ninguna.',
      );
    }

    const deVacantes = await this.vacantes.panelDeEmpresa(solicitante.idEmpresa);
    const idsAbiertas = deVacantes.abiertas.map((v) => v.id);
    const [conteosDeEntregas, finalistasEnEvaluacion, retosEnElBanco, conEntrega, evaluados] =
      await Promise.all([
        this.entregas.conteosPorEstadoDeVacantes(deVacantes.ids),
        this.entregas.candidatosEnEvaluacionDeVacantes(deVacantes.ids),
        this.ejerciciosDelBanco.cuantosEnElBanco(solicitante.idEmpresa),
        this.entregas.candidatosConEntregaPorVacante(idsAbiertas),
        this.evaluacion.candidatosEvaluadosPorVacante(idsAbiertas),
      ]);

    this.registrar('panel_de_empresa_consultado', solicitante, {
      idEmpresa: solicitante.idEmpresa,
    });

    return {
      vacantes: {
        borradores: deVacantes.porEstado[EstadoVacante.Borrador],
        publicadas: deVacantes.porEstado[EstadoVacante.Publicada],
        cerradas: deVacantes.porEstado[EstadoVacante.Cerrada],
      },
      finalistasEnEvaluacion,
      abiertas: deVacantes.abiertas.map((v) => progresoDe(v, conEntrega, evaluados)),
      entregasPorEvaluar:
        conteosDeEntregas[EstadoEntrega.Recibida] + conteosDeEntregas[EstadoEntrega.EnEvaluacion],
      entregasEvaluadas: conteosDeEntregas[EstadoEntrega.Evaluada],
      entregasFallidas: conteosDeEntregas[EstadoEntrega.Fallida],
      contratados: deVacantes.contratados,
      retosEnElBanco,
      generadoEn: new Date(),
    };
  }

  /** Ranking de una vacante con sus cifras consolidadas. */
  async deVacante(idVacante: string, solicitante: Solicitante): Promise<ReporteDeVacante> {
    // La vacante primero: si no es de su empresa, aqui se corta con un 404 y no
    // se llega a tocar ninguna nota.
    const vacante = await this.vacantes.obtenerPara(idVacante, solicitante);

    const [evaluaciones, conteos] = await Promise.all([
      this.evaluacion.deVacante(idVacante, solicitante),
      this.entregas.conteosPorEstado(idVacante, solicitante),
    ]);

    const paraReporte = evaluaciones.map(aFormaDeReporte);
    const ranking = rankingDeCandidatos(paraReporte);
    const resumen = resumenDeVacante(ranking, paraReporte, {
      enProceso: conteos[EstadoEntrega.Recibida] + conteos[EstadoEntrega.EnEvaluacion],
      fallidas: conteos[EstadoEntrega.Fallida],
    });

    this.registrar('reporte_de_vacante_consultado', solicitante, {
      idVacante,
      candidatos: ranking.length,
    });

    return {
      vacante: cabecera(vacante),
      resumen,
      ranking: ranking.map((fila) => ({
        ...fila,
        alias: aliasDeCandidato(idVacante, fila.idCandidato),
      })),
      generadoEn: new Date(),
    };
  }

  /**
   * El detalle de un candidato en una vacante: todos sus intentos evaluados,
   * con el desglose por criterio y la evidencia de cada puntaje.
   *
   * Va DENTRO de la vacante a proposito. Un reporte "del candidato" sin vacante
   * mostraria su historial en otras empresas, y eso es justo lo que prohibe el
   * tercer criterio del paquete.
   */
  async deCandidatoEnVacante(
    idVacante: string,
    idCandidato: string,
    solicitante: Solicitante,
  ): Promise<ReporteDeCandidato> {
    const vacante = await this.vacantes.obtenerPara(idVacante, solicitante);
    const todas = (await this.evaluacion.deVacante(idVacante, solicitante)).map(aFormaDeReporte);
    const suyas = todas.filter((e) => e.idCandidato === idCandidato);

    if (suyas.length === 0) {
      // Mismo 404 que si la vacante no fuera suya: quien pregunta no averigua
      // si ese identificador es de un candidato que existe.
      throw new NotFoundException('Ese candidato no tiene evaluaciones en esta vacante.');
    }

    const posicion =
      rankingDeCandidatos(todas).find((f) => f.idCandidato === idCandidato)?.posicion ?? null;

    this.registrar('reporte_de_candidato_consultado', solicitante, { idVacante, idCandidato });

    return {
      vacante: cabecera(vacante),
      alias: aliasDeCandidato(idVacante, idCandidato),
      idCandidato,
      posicionEnLaVacante: posicion,
      // Del intento mas reciente al mas viejo: es como se lee un historial.
      intentos: [...suyas].sort((a, b) => b.creadaEn.getTime() - a.creadaEn.getTime()),
      generadoEn: new Date(),
    };
  }

  /**
   * Informe de auditoria de una vacante (pantalla A09).
   *
   * Reune lo que se puede AFIRMAR con los datos que la plataforma tiene:
   * integridad de las evaluaciones, distribucion de las notas y el rastro de
   * quien reveló que identidad y a quien se contrato.
   *
   * LO QUE NO AFIRMA, Y LO DICE: la auditoria de SESGO (tasas por grupo) exige un
   * dato demografico que no se recoge. El informe no inventa una cifra: dice que
   * no es medible y por que. Eso es mas util en una auditoria que un numero
   * que parece una medicion y no lo es.
   */
  async auditoriaDeVacante(
    idVacante: string,
    solicitante: Solicitante,
  ): Promise<AuditoriaDeVacante> {
    const [reporte, integridad, revelaciones, vacante] = await Promise.all([
      this.deVacante(idVacante, solicitante),
      this.evaluacion.integridadDeVacante(idVacante),
      this.revelacionesDe(idVacante, solicitante),
      this.vacantes.obtenerPara(idVacante, solicitante),
    ]);
    const notas = reporte.ranking.map((f) => f.notaFinal);
    const histograma = Array.from({ length: 10 }, (_, i) => ({
      desde: i * 10,
      hasta: i === 9 ? 100 : i * 10 + 9,
      candidatos: 0,
    }));
    for (const n of notas) histograma[Math.min(9, Math.floor(n / 10))].candidatos += 1;
    this.registrar('auditoria_de_vacante_consultada', solicitante, { idVacante });
    return {
      vacante: reporte.vacante,
      generadoEn: new Date(),
      integridad: {
        ...integridad,
        entregasFallidas: reporte.resumen.entregasFallidas,
        entregasEnProceso: reporte.resumen.entregasEnProceso,
      },
      distribucion: {
        candidatosEvaluados: reporte.resumen.candidatosEvaluados,
        notaPromedio: reporte.resumen.notaPromedio,
        notaMediana: reporte.resumen.notaMediana,
        notaMinima: reporte.resumen.notaMinima,
        notaMaxima: reporte.resumen.notaMaxima,
        histograma,
      },
      trazabilidad: {
        identidadesReveladas: revelaciones.length,
        revelaciones: revelaciones.map((r) => ({
          alias: r.alias,
          idUsuario: r.idUsuario,
          reveladaEn: r.reveladaEn,
        })),
        contratados: (vacante.candidatos ?? []).filter((c) => c.contratadoEn !== null).length,
      },
      sesgo: {
        medible: false,
        motivo:
          'La plataforma no recoge datos demograficos, asi que no se calculan tasas por grupo. ' +
          'Una cifra de sesgo sin ese dato seria inventada. Medirlo exige decidir que dato recoger y con que consentimiento.',
      },
    };
  }

  /**
   * Revela la identidad de un candidato, y deja rastro.
   *
   * El ranking muestra alias porque el proposito del producto es reducir el
   * sesgo. Revelar es entonces una accion deliberada —"contactar
   * seleccionados" en la pantalla A06— y no un campo mas de una consulta.
   *
   * SE REGISTRA ANTES DE DEVOLVER. Si el guardado fallara, la identidad no
   * sale: una revelacion sin rastro es exactamente lo que esta tabla existe
   * para impedir, y es preferible negar el dato a entregarlo sin registro.
   */
  async revelarIdentidad(
    idVacante: string,
    idCandidato: string,
    solicitante: Solicitante,
  ): Promise<IdentidadRevelada> {
    const vacante = await this.vacantes.obtenerPara(idVacante, solicitante);

    // Mismo 404 que el detalle: no se revela a quien no participa en esta
    // vacante, y quien pregunta no averigua si ese identificador existe.
    const evaluaciones = await this.evaluacion.deVacante(idVacante, solicitante);
    if (!evaluaciones.some((e) => e.idCandidato === idCandidato)) {
      throw new NotFoundException('Ese candidato no tiene evaluaciones en esta vacante.');
    }

    const identidades = await this.autenticacion.identidadesDe([idCandidato]);
    const identidad = identificar(identidades, idCandidato);

    const registro = await this.revelaciones.save(
      this.revelaciones.create({
        idVacante,
        idCandidato,
        idEmpresa: vacante.idEmpresa,
        idUsuario: solicitante.id,
      }),
    );

    this.registrar('identidad_revelada', solicitante, { idVacante, idCandidato });

    return {
      alias: aliasDeCandidato(idVacante, idCandidato),
      idCandidato,
      nombre: identidad.nombre,
      correo: identidad.correo,
      reveladaEn: registro.reveladaEn,
    };
  }

  /**
   * Quien revelo que identidades en esta vacante.
   *
   * Un registro de auditoria que nadie puede consultar no es una auditoria.
   * Va por la misma puerta que el resto del reporte, asi que la frontera de
   * empresa se aplica igual: `obtenerPara` responde 404 si la vacante es de
   * otra.
   */
  async revelacionesDe(
    idVacante: string,
    solicitante: Solicitante,
  ): Promise<RevelacionRegistrada[]> {
    await this.vacantes.obtenerPara(idVacante, solicitante);

    const registros = await this.revelaciones.find({
      where: { idVacante },
      order: { reveladaEn: 'DESC' },
    });

    return registros.map((r) => ({
      alias: aliasDeCandidato(idVacante, r.idCandidato),
      idCandidato: r.idCandidato,
      idUsuario: r.idUsuario,
      reveladaEn: r.reveladaEn,
    }));
  }

  /**
   * El ranking en CSV (entregable "exportacion basica del reporte").
   *
   * Una fila por candidato y no una por criterio: es la tabla que el reclutador
   * quiere pegar en un correo o en su hoja de seguimiento. El desglose completo
   * vive en el detalle por candidato, que es donde se mira una nota concreta.
   */
  async csvDeVacante(
    idVacante: string,
    solicitante: Solicitante,
  ): Promise<{ nombre: string; contenido: string }> {
    const reporte = await this.deVacante(idVacante, solicitante);

    const columnas: Columna<FilaConCandidato>[] = [
      { titulo: 'Posicion', valor: (f) => f.posicion },
      // Alias y no nombre: el CSV sale de la misma tabla y se reenvia por
      // correo con mas facilidad todavia. Un export que filtra lo que la
      // pantalla protege no protege nada.
      { titulo: 'Candidato', valor: (f) => f.alias },
      { titulo: 'Nota final', valor: (f) => f.notaFinal },
      { titulo: 'Intentos evaluados', valor: (f) => f.intentosEvaluados },
      { titulo: 'Evaluada en', valor: (f) => f.evaluadaEn },
      // La misma columna que la pantalla A06: en una tabla de notas parecidas
      // es lo que distingue a una persona de otra.
      { titulo: 'Habilidad destacada', valor: (f) => f.habilidadDestacada?.criterio ?? '' },
      {
        titulo: 'Logro en esa habilidad',
        valor: (f) => (f.habilidadDestacada ? `${f.habilidadDestacada.porcentajeLogrado}%` : ''),
      },
      { titulo: 'Riesgo de inyeccion', valor: (f) => f.riesgoInyeccion },
      { titulo: 'Id de entrega', valor: (f) => f.idEntrega },
    ];

    return {
      nombre: `reporte-${nombreDeArchivo(reporte.vacante.titulo)}.csv`,
      contenido: aCsv(reporte.ranking, columnas),
    };
  }

  private registrar(
    evento: string,
    solicitante: Solicitante,
    metadata: Record<string, unknown>,
  ): void {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        eventType: evento,
        userId: solicitante.id,
        metadata,
      }),
    );
  }
}

const cabecera = (v: { id: string; titulo: string; estado: string }): CabeceraDeVacante => ({
  id: v.id,
  titulo: v.titulo,
  estado: v.estado,
});

/** Nombre y correo, o un marcador si la cuenta ya no existe. */
function identificar(identidades: Map<string, Identidad>, id: string): Identidad {
  // Una cuenta borrada no debe tumbar la consulta: la nota sigue siendo valida
  // y el reclutador tiene que poder ver que esa fila existio.
  return identidades.get(id) ?? { nombre: 'Candidato no disponible', correo: '' };
}

/** Un titulo de vacante no decide el nombre de un archivo. */
function nombreDeArchivo(titulo: string): string {
  const limpio = titulo
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return limpio || 'vacante';
}

/** La forma en la que llega una evaluacion por la puerta de su modulo. */
interface EvaluacionLeida {
  id: string;
  idEntrega: string;
  idCandidato: string;
  idEjercicio: string;
  notaFinal: number;
  creadaEn: Date;
  riesgoInyeccion: string;
  criterios?: {
    criterio: string;
    puntaje: number;
    escalaMaxima: number;
    peso: number;
    evidencia: string;
  }[];
}

function aFormaDeReporte(e: EvaluacionLeida): EvaluacionParaReporte {
  return {
    idEvaluacion: e.id,
    idEntrega: e.idEntrega,
    idCandidato: e.idCandidato,
    idEjercicio: e.idEjercicio,
    notaFinal: e.notaFinal,
    creadaEn: e.creadaEn,
    riesgoInyeccion: e.riesgoInyeccion,
    criterios: e.criterios ?? [],
  };
}

export interface CabeceraDeVacante {
  id: string;
  titulo: string;
  estado: string;
}

export interface FilaConCandidato extends FilaDeRanking {
  /** Alias estable dentro de la vacante. El nombre NO viaja en el ranking. */
  alias: string;
}

export interface ReporteDeVacante {
  vacante: CabeceraDeVacante;
  resumen: ResumenDeVacante;
  ranking: FilaConCandidato[];
  generadoEn: Date;
}

export interface IdentidadRevelada {
  alias: string;
  idCandidato: string;
  nombre: string;
  correo: string;
  reveladaEn: Date;
}

export interface RevelacionRegistrada {
  alias: string;
  idCandidato: string;
  /** Quien la revelo. */
  idUsuario: string;
  reveladaEn: Date;
}

export interface ReporteDeCandidato {
  vacante: CabeceraDeVacante;
  alias: string;
  idCandidato: string;
  posicionEnLaVacante: number | null;
  intentos: EvaluacionParaReporte[];
  generadoEn: Date;
}

/**
 * Las cifras del panel de la empresa (pantalla A02).
 *
 * `finalistasEnEvaluacion` cuenta PERSONAS y `entregasPorEvaluar` cuenta
 * ENTREGAS: la diferencia entre las dos son los reintentos. Van las dos porque
 * la pantalla muestra personas y la operacion necesita entregas —una cola que
 * crece se ve en la segunda, no en la primera.
 */
export interface PanelDeEmpresa {
  vacantes: { borradores: number; publicadas: number; cerradas: number };
  /** Una fila por vacante publicada, con su avance. Lo que A02 pinta como tarjetas. */
  abiertas: ProgresoDeVacante[];
  finalistasEnEvaluacion: number;
  entregasPorEvaluar: number;
  entregasEvaluadas: number;
  entregasFallidas: number;
  contratados: number;
  /** Ejercicios activos del banco. Los retirados no se cuentan. */
  retosEnElBanco: number;
  generadoEn: Date;
}

/** Una oferta del catalogo, con el % de afinidad de quien pregunta. */
export interface OfertaConAfinidad extends OfertaDelCatalogo {
  readonly afinidad: Afinidad;
}

/** Una habilidad del perfil del candidato, con el nivel en porcentaje. */
export interface HabilidadDelPerfil {
  readonly nombre: string;
  /** 0 a 100. */
  readonly nivel: number;
  readonly veces: number;
}

export interface FilaDeTalento {
  idCandidato: string;
  alias: string;
  mejorNota: number;
  evaluaciones: number;
}

export interface DatosPersonales {
  generadoEn: Date;
  perfil: {
    id: string;
    nombreCompleto: string;
    correo: string;
    rol: string;
    idEmpresa: string | null;
    creadoEn: Date;
  };
  consentimientos: {
    tipo: string;
    concedido: boolean;
    versionDelAviso: string;
    origen: string;
    registradoEn: Date;
  }[];
  entregas: {
    id: string;
    idVacante: string;
    idEjercicio: string;
    numeroIntento: number;
    estado: string;
    archivoNombre: string;
    archivoBytes: number;
    creadaEn: Date;
  }[];
  evaluaciones: {
    idEntrega: string;
    notaFinal: number;
    creadaEn: Date;
    criterios: { criterio: string; puntaje: number; escalaMaxima: number; evidencia: string }[];
  }[];
  postulaciones: {
    idVacante: string;
    estado: string;
    motivoDelRechazo: string | null;
    creadaEn: Date;
  }[];
}

export interface UsoDeEjercicio {
  idEjercicio: string;
  vacantes: number;
  evaluaciones: number;
  notaPromedio: number | null;
}

export interface AuditoriaDeVacante {
  vacante: CabeceraDeVacante;
  generadoEn: Date;
  integridad: {
    evaluaciones: number;
    descalificadas: number;
    riesgoAlto: number;
    riesgoMedio: number;
    entregasFallidas: number;
    entregasEnProceso: number;
  };
  distribucion: {
    candidatosEvaluados: number;
    notaPromedio: number | null;
    notaMediana: number | null;
    notaMinima: number | null;
    notaMaxima: number | null;
    histograma: { desde: number; hasta: number; candidatos: number }[];
  };
  trazabilidad: {
    identidadesReveladas: number;
    revelaciones: { alias: string; idUsuario: string; reveladaEn: Date }[];
    contratados: number;
  };
  sesgo: { medible: false; motivo: string };
}
