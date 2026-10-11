import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvaluacionService } from './evaluacion.service.js';
import { EvaluacionesController } from './evaluaciones.controller.js';
import { ColaDeEvaluacionService } from './cola/cola-de-evaluacion.service.js';
import { EVALUADOR, EvaluadorSinServicioDeIa } from './cola/evaluador.js';
import { EvaluadorQuePersiste } from './cola/evaluador-que-persiste.js';
import { ClienteServicioIa } from './cola/cliente-servicio-ia.js';
import { Evaluacion } from './entities/evaluacion.entity.js';
import { CalificacionCriterio } from './entities/calificacion-criterio.entity.js';
import { AutenticacionModule } from '../autenticacion/index.js';
import { EntregasModule } from '../entregas/index.js';
import { EjerciciosModule } from '../ejercicios/index.js';
import { VacantesModule } from '../vacantes/index.js';
import { AlmacenamientoModule } from '../../common/almacenamiento/index.js';

/** Orquesta la calificacion: arma el envio al servicio de IA y guarda resultados. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Evaluacion, CalificacionCriterio]),
    AutenticacionModule,
    EntregasModule,
    EjerciciosModule,
    VacantesModule,
    AlmacenamientoModule,
  ],
  controllers: [EvaluacionesController],
  providers: [
    EvaluacionService,
    ColaDeEvaluacionService,
    ClienteServicioIa,
    EvaluadorQuePersiste,
    EvaluadorSinServicioDeIa,
    {
      // Con el servicio de IA configurado se evalua de verdad y se persiste
      // (paquete 4.5). Sin configurar, el evaluador honesto del 4.4: falla
      // en vez de inventar una nota.
      provide: EVALUADOR,
      inject: [ClienteServicioIa, EvaluadorQuePersiste, EvaluadorSinServicioDeIa],
      useFactory: (
        cliente: ClienteServicioIa,
        conServicio: EvaluadorQuePersiste,
        sinServicio: EvaluadorSinServicioDeIa,
      ) => (cliente.configurado ? conServicio : sinServicio),
    },
  ],
  exports: [EvaluacionService, ColaDeEvaluacionService],
})
export class EvaluacionModule {}
