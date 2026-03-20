export interface JwtPayload {
  sub: string;
  type: 'resident' | 'employee';
  role?: string;
}
