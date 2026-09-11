// Elementos transversales de verdad: tipos comunes, eventos de dominio,
// cifrado, politica de CORS y limites de peticiones. Nada de logica de negocio
// de ningun modulo.
export type { DomainEvent } from './events/index.js';
export {
  CifradoService,
  ClaveDeCifradoInvalidaError,
  DescifradoFallidoError,
  columnaCifrada,
  establecerServicioDeCifrado,
  leerClaveDeCifrado,
} from './cifrado/index.js';
export { construirOpcionesCors, origenesPermitidos, OrigenNoPermitidoError } from './cors/index.js';
export { RateLimitModule, LimiteLogin, LimiteEntrega } from './rate-limit/index.js';
