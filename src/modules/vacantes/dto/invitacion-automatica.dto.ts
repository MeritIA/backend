import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/**
 * La politica de invitacion automatica de una vacante (A04).
 *
 * `umbral` nulo con `activa: true` NO es cero: es modo abierto, acepta a todo el
 * que se postule hasta el cupo. La diferencia esta explicada en
 * `dominio/politica-de-invitacion.ts` y es deliberada, porque el modo abierto es
 * el unico que no tiene trampa del principiante.
 */
export class InvitacionAutomaticaDto {
  @ApiProperty({
    description:
      'Si la vacante invita sola. Al encenderla se procesan las postulaciones que ya estaban en revision.',
  })
  @IsBoolean({ message: 'activa debe ser booleano' })
  activa!: boolean;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    nullable: true,
    description:
      'Minimo de afinidad para entrar sola. Omitirlo o enviarlo nulo con activa=true significa ACEPTAR A TODOS hasta el cupo: ' +
      'el reto pasa a ser el unico filtro. Con umbral, quien no tiene evidencia NO se rechaza: queda en revision para una persona.',
  })
  @IsOptional()
  @ValidateIf((o: InvitacionAutomaticaDto) => o.umbral !== null && o.umbral !== undefined)
  @IsInt({ message: 'umbral debe ser un entero' })
  @Min(0, { message: 'umbral no puede ser negativo' })
  @Max(100, { message: 'umbral es un porcentaje: como maximo 100' })
  umbral?: number | null;

  @ApiPropertyOptional({
    minimum: 0,
    nullable: true,
    description:
      'Tope de invitaciones AUTOMATICAS. Nulo es sin tope. No limita las invitaciones a mano: `finalistasAEvaluar` sigue siendo un plan y no un maximo (D-12).',
  })
  @IsOptional()
  @ValidateIf((o: InvitacionAutomaticaDto) => o.cupo !== null && o.cupo !== undefined)
  @IsInt({ message: 'cupo debe ser un entero' })
  @Min(0, { message: 'cupo no puede ser negativo' })
  cupo?: number | null;
}
