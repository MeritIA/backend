import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsBoolean, IsEnum, ValidateNested } from 'class-validator';
import {
  OrigenDelConsentimiento,
  TipoDeConsentimiento,
  TIPOS_OFRECIDOS,
} from '../dominio/consentimiento.js';

/** Una decision sobre un permiso. */
export class DecisionDto {
  // El contrato anuncia solo las finalidades vigentes. La validacion sigue
  // aceptando el enum completo a proposito: asi una pantalla vieja que mande
  // una retirada recibe "ya no se pide" en vez de un error de formato que no
  // explica nada.
  @ApiProperty({ enum: TIPOS_OFRECIDOS })
  @IsEnum(TipoDeConsentimiento, { message: 'tipo no es un permiso conocido' })
  tipo!: TipoDeConsentimiento;

  @ApiProperty({ description: 'true lo concede, false lo revoca.' })
  @IsBoolean({ message: 'concedido debe ser true o false' })
  concedido!: boolean;
}

/**
 * Lo que mandan B12 (el registro) y B24 (el panel de privacidad).
 *
 * El origen va en el cuerpo porque es parte de la prueba del consentimiento:
 * no es lo mismo haberlo aceptado en el paso 2 del registro que haberlo
 * encendido despues en el perfil. No se deduce de la ruta porque la ruta es la
 * misma: la decision es la misma operacion, cambia de donde viene.
 */
export class RegistrarConsentimientosDto {
  @ApiProperty({ type: [DecisionDto], maxItems: TIPOS_OFRECIDOS.length })
  @ArrayNotEmpty({ message: 'hay que enviar al menos una decision' })
  // Mas decisiones que permisos solo puede ser un tipo repetido.
  @ArrayMaxSize(TIPOS_OFRECIDOS.length, {
    message: 'hay mas decisiones que permisos: algun tipo viene repetido',
  })
  @ValidateNested({ each: true })
  @Type(() => DecisionDto)
  decisiones!: DecisionDto[];

  @ApiPropertyOptional({
    enum: OrigenDelConsentimiento,
    default: OrigenDelConsentimiento.Perfil,
    description: 'Desde donde se decidio. Forma parte de la prueba del consentimiento.',
  })
  @IsEnum(OrigenDelConsentimiento, { message: 'origen no es valido' })
  origen: OrigenDelConsentimiento = OrigenDelConsentimiento.Perfil;
}

/** Un permiso con su texto y lo que el titular autoriza hoy. */
export class PermisoRespuesta {
  @ApiProperty({ enum: TIPOS_OFRECIDOS }) tipo!: TipoDeConsentimiento;

  @ApiProperty() titulo!: string;

  @ApiProperty({ description: 'El texto que la pantalla muestra y que el titular acepta.' })
  descripcion!: string;

  @ApiProperty() concedido!: boolean;

  @ApiProperty({
    description: 'true si vale el valor por omision porque el titular nunca lo decidio.',
  })
  porOmision!: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  decididoEn!: Date | null;

  @ApiProperty({ nullable: true, type: String, description: 'Version del aviso que acepto.' })
  versionDelAviso!: string | null;

  @ApiProperty({ description: 'Si la pantalla de registro (B12) lo pregunta.' })
  sePideEnElRegistro!: boolean;

  @ApiProperty({ description: 'Que pasaria al revocarlo.' })
  efecto!: string;

  @ApiProperty({
    description:
      'Si el backend lo hace cumplir HOY. Los cuatro estan en false: las funciones que ' +
      'gobiernan no existen todavia. Va aqui a proposito, para que la pantalla no prometa ' +
      'un control que nadie vigila.',
  })
  vigilado!: boolean;
}

export class ConsentimientosRespuesta {
  @ApiProperty({ type: [PermisoRespuesta] })
  permisos!: PermisoRespuesta[];

  @ApiProperty({ description: 'Version vigente del aviso de privacidad.' })
  versionDelAviso!: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Decisiones guardadas en esta llamada. Las que no cambian nada no se guardan.',
  })
  registradas?: number;
}
