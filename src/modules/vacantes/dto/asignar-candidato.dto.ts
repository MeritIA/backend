import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AsignarCandidatoDto {
  @ApiProperty({ format: 'uuid', description: 'Candidato al que se invita a esta vacante.' })
  @IsUUID('4', { message: 'idCandidato debe ser un identificador valido' })
  idCandidato!: string;
}
