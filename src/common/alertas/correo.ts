import { Injectable, Logger, Optional } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/** Lo que paso con un envio. Se guarda tal cual en la tabla de notificaciones. */
export type ResultadoDeEnvio = 'enviado' | 'sin_canal' | 'fallido';

/**
 * Envio de correo. Lo usan dos cosas distintas y conviene tenerlo claro:
 *
 * 1. Las ALERTAS DE SEGURIDAD (paquete 5.5) con `enviar()`, que van siempre a
 *    los destinatarios fijos de `ALERTAS_DESTINO` —el equipo—.
 * 2. Las NOTIFICACIONES A CANDIDATOS con `enviarA()`, que van a una direccion
 *    que llega como argumento.
 *
 * Va aparte del servicio de alertas para que las reglas —cuando avisar— se
 * puedan probar sin tocar SMTP, y para que cambiar de canal manana sea escribir
 * otra clase como esta.
 *
 * SIN CONFIGURAR NO ROMPE NADA
 *
 * Si faltan las variables de SMTP, el correo queda deshabilitado y lo que se
 * iba a enviar se registra en el log con un aviso. Es lo mismo que hace el
 * servicio de IA: un entorno de desarrollo sin credenciales tiene que poder
 * arrancar, y un entorno de produccion sin canal tiene que decirlo en voz alta
 * en vez de fallar al enviar el primer aviso.
 *
 * LA REDIRECCION, Y POR QUE EXISTE
 *
 * `CORREO_REDIRECCION` manda TODO el correo a candidatos a una sola direccion,
 * con el destinatario real escrito en el cuerpo. No es un adorno de pruebas: el
 * dia que un entorno de preproduccion tenga SMTP de verdad, sin esto el primer
 * `docker compose up` con datos sembrados le escribe a personas reales. Las
 * alertas no se redirigen: ya van al equipo.
 */
@Injectable()
export class CorreoService {
  private readonly logger = new Logger('Correo');
  private transporte: Transporter | undefined;
  private readonly desde: string;
  private readonly destinatarios: string[];
  private readonly redireccion: string | undefined;

  /**
   * `env` va como @Optional() para que Nest no intente inyectarlo: es un
   * parametro de conveniencia para las pruebas, no una dependencia del
   * contenedor. En ejecucion siempre cae a process.env. Mismo motivo que en
   * PasetoService, y sin esto el contenedor no puede construir esta clase.
   */
  constructor(@Optional() env: NodeJS.ProcessEnv = process.env) {
    const host = env.SMTP_HOST;
    const puerto = Number(env.SMTP_PORT ?? 587);
    this.desde = env.SMTP_DESDE ?? 'alertas@meritia.local';
    this.destinatarios = (env.ALERTAS_DESTINO ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    this.redireccion = env.CORREO_REDIRECCION?.trim() || undefined;

    // El transporte depende solo del host: `ALERTAS_DESTINO` es cosa de las
    // alertas, y exigirlo aqui dejaria sin canal al correo a candidatos.
    if (!host) return;

    this.transporte = createTransport({
      host,
      port: puerto,
      // 465 es SMTP sobre TLS directo; el resto negocia STARTTLS.
      secure: puerto === 465,
      ...(env.SMTP_USUARIO
        ? { auth: { user: env.SMTP_USUARIO, pass: env.SMTP_CONTRASENA ?? '' } }
        : {}),
    });
  }

  /** El canal de ALERTAS: hace falta el servidor y a quien avisar. */
  get configurado(): boolean {
    return this.transporte !== undefined && this.destinatarios.length > 0;
  }

  /** Hay servidor de salida, sin importar a quien. Lo que mira el correo a candidatos. */
  get hayTransporte(): boolean {
    return this.transporte !== undefined;
  }

  /**
   * Envia el aviso de seguridad al equipo. Nunca lanza: una alerta que tumba la
   * peticion que la origino convierte un problema en dos.
   */
  async enviar(asunto: string, cuerpo: string): Promise<boolean> {
    if (!this.configurado) {
      this.registrar('warn', 'alerta_sin_canal', {
        asunto,
        detalle: 'Alerta sin enviar: falta configurar SMTP_HOST y ALERTAS_DESTINO',
      });
      return false;
    }
    return (await this.entregar(this.destinatarios, asunto, cuerpo, 'alerta')) === 'enviado';
  }

  /**
   * Envia a una direccion concreta. Tampoco lanza: quien notifica a un
   * candidato guarda el resultado y sigue con el siguiente, porque un buzon
   * lleno no puede dejar sin aviso a los demas.
   *
   * No se registra la direccion en el log: es un dato personal y el log no es
   * el lugar. Se registra a quien corresponde por identificador, que es lo que
   * hace falta para auditar.
   */
  async enviarA(para: string, asunto: string, cuerpo: string): Promise<ResultadoDeEnvio> {
    if (!this.transporte) {
      this.registrar('warn', 'correo_sin_canal', { asunto });
      return 'sin_canal';
    }

    if (this.redireccion) {
      return this.entregar(
        [this.redireccion],
        `[redirigido] ${asunto}`,
        `Este correo iba a: ${para}\n` +
          `Se redirigio porque CORREO_REDIRECCION esta puesta en este entorno.\n` +
          `${'-'.repeat(60)}\n\n${cuerpo}`,
        'notificacion',
      );
    }

    return this.entregar([para], asunto, cuerpo, 'notificacion');
  }

  private async entregar(
    para: string[],
    asunto: string,
    cuerpo: string,
    clase: 'alerta' | 'notificacion',
  ): Promise<ResultadoDeEnvio> {
    try {
      await this.transporte?.sendMail({
        from: this.desde,
        to: para,
        subject: asunto,
        text: cuerpo,
      });
      return 'enviado';
    } catch (e) {
      this.registrar('error', clase === 'alerta' ? 'alerta_no_enviada' : 'correo_no_enviado', {
        asunto,
        detalle: e instanceof Error ? e.message : String(e),
      });
      return 'fallido';
    }
  }

  private registrar(nivel: 'warn' | 'error', eventType: string, metadata: object): void {
    const linea = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: nivel,
      eventType,
      metadata,
    });
    if (nivel === 'warn') this.logger.warn(linea);
    else this.logger.error(linea);
  }
}
