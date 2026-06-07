import { createClient } from 'next-sanity'

import { apiVersion, dataset, projectId } from '../env'

export const client = createClient({
  projectId,
  dataset,
  apiVersion,
  // These pages are statically generated (ISR) and rely on revalidatePath() after
  // admin mutations. The CDN serves cached query results, so a regenerated page would
  // be rebuilt from stale data — keep this false so each regeneration reads live.
  useCdn: false,
})
