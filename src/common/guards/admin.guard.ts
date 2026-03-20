import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;
    if (!user || user.type !== 'employee' || user.role !== 'administrator') {
      throw new ForbiddenException('Only administrators can access this resource');
    }
    return true;
  }
}
