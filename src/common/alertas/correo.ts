import { Injectable, Logger, Optional } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Envio de correo para las alertas (paquete 5.5).
 *
 * El equipo eligio el correo como canal. Va aparte del servicio de alertas
 * para que las reglas —cuando avisar— se puedan probar sin tocar SMTP, y para
 * que cambiar de canal manana sea escribir otra clase como esta.
 *
 * SIN CONFIGURAR NO ROMPE NADA
 *
 * Si faltan las variables de SMTP, el correo queda deshabilitado y la alerta se
 * registra en el log con un aviso. Es lo mismo que hace el servicio de IA: un
 * entorno de desarrollo sin credenciales tiene que poder arrancar, y un entorno
 * de produccion sin canal de alertas tiene que decirlo en voz alta en vez de
 * fallar al enviar el primer aviso.
 */
@Injectable()
export class CorreoService {
  private readonly logger = new Logger('Alertas');
  private transporte: Transporter | undefined;
  private readonly desde: string;
  private readonly destinatarios: string[];

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

    if (!host || this.destinatarios.length === 0) return;

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

  get configurado(): boolean {
    return this.transporte !== undefined;
  }

  /**
   * Envia el aviso. Nunca lanza: una alerta que tumba la peticion que la
   * origino convierte un problema en dos.
   */
  async enviar(asunto: string, cuerpo: string): Promise<boolean> {
    if (!this.transporte) {
      this.logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warn',
          eventType: 'alerta_sin_canal',
          message: 'Alerta sin enviar: falta configurar SMTP_HOST y ALERTAS_DESTINO',
          metadata: { asunto },
        }),
      );
      return false;
    }

    try {
      await this.transporte.sendMail({
        from: this.desde,
        to: this.destinatarios,
        subject: asunto,
        text: cuerpo,
      });
      return true;
    } catch (e) {
      this.logger.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          eventType: 'alerta_no_enviada',
          metadata: { asunto, detalle: e instanceof Error ? e.message : String(e) },
        }),
      );
      return false;
    }
  }
}
