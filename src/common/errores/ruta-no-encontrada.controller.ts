import { All, Controller, NotFoundException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * Captura cualquier ruta que ningun controlador atienda.
 *
 * Sin esto, una ruta inexistente la responde Express con su pagina HTML por
 * defecto: nunca entra en el pipeline de Nest, asi que el filtro global de
 * excepciones no la ve. El resultado es que la API contesta JSON en todos sus
 * errores menos en este, y ademas delata el servidor que hay debajo.
 *
 * Aqui se lanza una NotFoundException normal, que el filtro global convierte en
 * la misma forma de respuesta que cualquier otro error.
 *
 * Va sin version (`VERSION_NEUTRAL`) para cubrir tambien las rutas que no traen
 * prefijo de version, que son justo las que un cliente equivocado va a pedir.
 */
@ApiExcludeController()
@Controller({ path: '*ruta', version: VERSION_NEUTRAL })
export class RutaNoEncontradaController {
  @All()
  noEncontrada(): never {
    throw new NotFoundException('La ruta solicitada no existe en esta API.');
  }
}
