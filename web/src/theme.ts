import type { StatusKey } from './types'
export type { StatusKey }

export const STATUS: Record<StatusKey, { label: string }> = {
  optimal: { label: 'Optimal' }, watch: { label: 'Watch' }, critical: { label: 'Critical' }, unknown: { label: 'No data' },
}
export function getStatus(moisture: number | null, critTh: number, watchTh: number): StatusKey {
  if (moisture == null) return 'unknown'
  if (moisture < critTh) return 'critical'
  if (moisture < watchTh) return 'watch'
  return 'optimal'
}
