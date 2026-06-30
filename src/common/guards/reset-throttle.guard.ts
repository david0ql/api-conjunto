import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * Lightweight in-memory, per-IP rate limiter for the public password-reset
 * endpoints. The token itself has 256 bits of entropy (brute force is
 * infeasible), but this caps abusive traffic and probing.
 */
@Injectable()
export class ResetThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs = 60_000;
  private readonly max = 12;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip = (
      req.ip ||
      (Array.isArray(forwarded) ? forwarded[0] : forwarded) ||
      req.socket?.remoteAddress ||
      'unknown'
    ).toString();

    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(ip, recent);

    // Opportunistic cleanup so the map doesn't grow unbounded.
    if (this.hits.size > 5000) {
      for (const [key, times] of this.hits) {
        if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
      }
    }

    if (recent.length > this.max) {
      throw new HttpException(
        'Demasiados intentos. Espera un momento e intenta de nuevo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
