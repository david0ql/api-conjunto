import { AsyncLocalStorage } from 'async_hooks';

export interface ChangeContext {
  actorType: 'employee' | 'resident' | 'system';
  actorId: string | null;
  /** Se resuelve una sola vez por petición, la primera vez que se registra un cambio. */
  actorName?: string | null;
  /** Motivo opcional que acompaña los cambios de esta petición (p. ej. una reasignación). */
  reason?: string | null;
}

const storage = new AsyncLocalStorage<ChangeContext>();

/** Contexto de la petición HTTP actual: quién está haciendo los cambios. */
export function getChangeContext(): ChangeContext | undefined {
  return storage.getStore();
}

export function runWithChangeContext<T>(
  context: ChangeContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/** Adjunta un motivo a los cambios que se registren en el resto de la petición. */
export function setChangeReason(reason: string | null | undefined): void {
  const context = storage.getStore();
  if (context) context.reason = reason?.trim() || null;
}
