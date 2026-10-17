import type { RegionData } from '@/lib/region'

/** Region registry. Each region's geometry is its own lazily-loaded chunk. */
export const REGIONS = [
  { id: 'triad', name: 'Piedmont Triad, NC', load: () => import('./triad.json') },
  { id: 'seattle', name: 'Seattle Metro, WA', load: () => import('./seattle.json') },
  { id: 'phoenix', name: 'Phoenix Metro, AZ', load: () => import('./phoenix.json') },
] as const satisfies readonly { id: string; name: string; load: () => Promise<{ default: unknown }> }[]

export type RegionId = (typeof REGIONS)[number]['id']
export const DEFAULT_REGION: RegionId = 'triad'

export async function loadRegion(id: RegionId): Promise<RegionData> {
  const r = REGIONS.find((x) => x.id === id) ?? REGIONS[0]
  return (await r.load()).default as unknown as RegionData
}
