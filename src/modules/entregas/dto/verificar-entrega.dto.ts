import { IsIn } from 'class-validator';

export class VerificarEntregaDto {
  @IsIn(['camara', 'alterna'], { message: 'modalidad debe ser camara o alterna' })
  modalidad!: 'camara' | 'alterna';
}
