import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SesionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  idVacante!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  idEjercicio!: string;
}
