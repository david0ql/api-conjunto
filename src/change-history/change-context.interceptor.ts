import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { runWithChangeContext } from './change-context';

/**
 * Deja disponible durante toda la petición quién la hace (empleado o
 * residente), para que el historial de cambios sepa a quién atribuir cada
 * modificación sin pasar el usuario por todos los servicios. Corre después de
 * los guards, así que request.user ya está resuelto.
 */
@Injectable()
export class ChangeContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const changeContext = user
      ? { actorType: user.type, actorId: user.sub }
      : { actorType: 'system' as const, actorId: null };

    return new Observable((subscriber) =>
      runWithChangeContext(changeContext, () =>
        next.handle().subscribe(subscriber),
      ),
    );
  }
}
