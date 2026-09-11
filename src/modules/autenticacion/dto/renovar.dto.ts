import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenovarDto {
  @ApiProperty({
    description: 'Token de renovacion obtenido al iniciar sesion.',
    example: 'v4.public.eyJzdWIiOiIuLi4ifQ...',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(2048)
  tokenDeRenovacion!: string;
}
