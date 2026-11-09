import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsUUID, ValidateIf } from 'class-validator';

/**
 * A quien se invita: por identificador o por correo, exactamente uno.
 *
 * El correo existe porque el identificador es un UUID que el candidato tiene
 * que copiar de su cuenta y mandar por fuera; con el correo la empresa invita a
 * quien ya conoce.
 */
export class AsignarCandidatoDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Candidato al que se invita.' })
  @ValidateIf((o: AsignarCandidatoDto) => o.correo === undefined)
  @IsUUID('4', { message: 'idCandidato debe ser un identificador valido (o envia correo)' })
  idCandidato?: string;

  @ApiPropertyOptional({
    format: 'email',
    description:
      'Correo con el que el candidato se registro. Si no hay un candidato con ese correo ' +
      'se responde 404, sea porque no existe o porque es otro tipo de cuenta.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'correo debe ser un correo valido' })
  correo?: string;
}
