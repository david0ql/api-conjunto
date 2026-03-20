import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class PoolOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user || user.type !== 'employee') {
      throw new ForbiddenException('Only employees can access this resource');
    }

    if (user.role !== 'administrator' && user.role !== 'pool_attendant') {
      throw new ForbiddenException('Only pool operators can access this resource');
    }

    return true;
  }
}
