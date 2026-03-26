import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class EmployeeOrResidentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.type === 'resident') {
      return true;
    }

    if (user.type === 'employee' && user.role !== 'pool_attendant') {
      return true;
    }

    throw new ForbiddenException('Only residents or employees can access this resource');
  }
}
