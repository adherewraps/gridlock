import { useEffect, useState } from 'react'
import { loadRegion, type RegionId } from '@/data/regions'
import { indexRegion, type Region } from '@/lib/region'

/** Region geometry is code-split so the shell (and skeletons) paint immediately. */
export function useRegion(id: RegionId): Region | null {
  const [region, setRegion] = useState<{ id: RegionId; r: Region } | null>(null)
  useEffect(() => {
    let alive = true
    loadRegion(id).then((data) => { if (alive) setRegion({ id, r: indexRegion(data) }) })
    return () => { alive = false }
  }, [id])
  return region?.id === id ? region.r : null
}
