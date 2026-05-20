/** Normaliza placa colombiana: trim, mayúsculas, espacio en posición 3 para placas de 6 caracteres. */
export function normalizePlate(value?: string | null): string {
  if (!value) return ''
  const cleaned = value.replace(/\s+/g, '').toUpperCase().trim()
  if (cleaned.length === 6) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`
  }
  return cleaned
}
