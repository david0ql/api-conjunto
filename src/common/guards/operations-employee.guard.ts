import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class OperationsEmployeeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user || user.type !== 'employee') {
      throw new ForbiddenException('Only employees can access this resource');
    }

    if (!['administrator', 'porter', 'pool_attendant'].includes(user.role ?? '')) {
      throw new ForbiddenException('Only operations employees can access this resource');
    }

    return true;
  }
}
