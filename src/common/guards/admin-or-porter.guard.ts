import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class AdminOrPorterGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user || user.type !== 'employee' || !['administrator', 'porter'].includes(user.role ?? '')) {
      throw new ForbiddenException('Only administrators or porters can access this resource');
    }

    return true;
  }
}
