import { describe, expect, it } from 'vitest';
import { avisoDeCierre } from './plantillas.js';

describe('aviso de cierre de vacante', () => {
  const base = { nombre: 'Ana Gomez', tituloVacante: 'Desarrollador backend' };

  it('dice de que vacante habla, en el asunto y en el cuerpo', () => {
    // Quien se presento a tres procesos no sabe de cual le hablan sin esto.
    const aviso = avisoDeCierre(base);
    expect(aviso.asunto).toContain('Desarrollador backend');
    expect(aviso.cuerpo).toContain('Desarrollador backend');
  });

  it('saluda por el nombre de quien lo recibe', () => {
    expect(avisoDeCierre(base).cuerpo).toContain('Ana Gomez');
  });

  it('NO lleva la nota, ni el puesto, ni cuantos participaron', () => {
    // El resultado se mira autenticado en la plataforma. Esta prueba existe
    // para que nadie "mejore" la plantilla metiendo la cifra en el correo.
    const aviso = avisoDeCierre(base);
    const texto = `${aviso.asunto} ${aviso.cuerpo}`;
    expect(texto).not.toMatch(/\d+\s*(\/|de|sobre)\s*100/i);
    expect(texto).not.toMatch(/puesto\s+\d+/i);
    expect(texto).not.toMatch(/\bnota\b/i);
    expect(texto).not.toMatch(/participantes?\s*:/i);
    // Ninguna cifra, de hecho: no hay nada que contar en este correo.
    expect(aviso.cuerpo).not.toMatch(/\d/);
  });

  it('NO dice si la persona fue seleccionada o descartada', () => {
    const texto = avisoDeCierre(base).cuerpo.toLowerCase();
    for (const palabra of ['seleccionad', 'descartad', 'rechazad', 'contratad', 'felicidades']) {
      expect(texto).not.toContain(palabra);
    }
  });

  it('incluye la direccion de la plataforma solo si existe', () => {
    expect(avisoDeCierre(base).cuerpo).not.toContain('http');
    const conUrl = avisoDeCierre({ ...base, urlPlataforma: 'https://app.meritia.co' });
    expect(conUrl.cuerpo).toContain('https://app.meritia.co');
  });

  it('aplana los saltos de linea del titulo: por ahi se inyectan cabeceras SMTP', () => {
    // El titulo lo escribe un reclutador y acaba en la cabecera Subject. Un
    // salto de linea permitiria colar un Bcc y convertir el aviso en un envio
    // a terceros.
    const aviso = avisoDeCierre({
      ...base,
      tituloVacante: 'Backend\r\nBcc: filtracion@atacante.com',
    });
    expect(aviso.asunto).not.toMatch(/[\r\n]/);
    expect(aviso.asunto).toContain('Bcc: filtracion@atacante.com');
    expect(aviso.asunto.split('\n')).toHaveLength(1);
  });

  it('aplana tambien los saltos del nombre', () => {
    const aviso = avisoDeCierre({ ...base, nombre: 'Ana\nGomez' });
    expect(aviso.cuerpo).toContain('Ana Gomez');
  });

  it('recorta un titulo desmesurado en vez de arrastrar un asunto ilegible', () => {
    const aviso = avisoDeCierre({ ...base, tituloVacante: 'x'.repeat(400) });
    // El titulo se corta a 120; el resto es el envoltorio del asunto.
    expect(aviso.asunto.length).toBeLessThanOrEqual(150);
    expect(aviso.asunto).toContain('…');
  });

  it('el cuerpo termina con la firma y nada mas', () => {
    expect(avisoDeCierre(base).cuerpo.trimEnd().endsWith('MeritIA')).toBe(true);
  });
});
