import { ServicioDeIaNoDisponibleError } from './evaluador.js';

/**
 * Ejecuta `fn` con un tiempo maximo.
 *
 * Al vencer, aborta la senal (para que el adaptador cancele la llamada de red)
 * y rechaza con un error transitorio, que la cola reintenta. Sin este limite,
 * un servicio de IA colgado retendria el hueco del worker indefinidamente y la
 * cola dejaria de avanzar.
 */
export async function conTiempoLimite<T>(
  fn: (senal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controlador = new AbortController();
  let temporizador: NodeJS.Timeout | undefined;

  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      controlador.abort();
      rechazar(new ServicioDeIaNoDisponibleError(`El servicio de IA no respondio en ${ms} ms.`));
    }, ms);
  });

  const trabajo = fn(controlador.signal);
  // Si gana el limite, el trabajo puede rechazar despues: sin esto seria un
  // rechazo no manejado que tumba el proceso.
  trabajo.catch(() => undefined);

  try {
    return await Promise.race([trabajo, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}
