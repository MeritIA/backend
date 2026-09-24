export { AlmacenamientoModule } from './almacenamiento.module.js';
export {
  AlmacenamientoService,
  ClaveInvalidaError,
  ObjetoNoEncontradoError,
  type ReferenciaDeObjeto,
} from './almacenamiento.service.js';
export {
  ArchivoInvalidoError,
  EXTENSIONES_PERMITIDAS,
  TAMANO_MAXIMO_BYTES,
  claveEsValida,
  extensionValidada,
} from './politica-de-nombres.js';
