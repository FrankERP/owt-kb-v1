'use client'

/**
 * This configuration is used to for the Sanity Studio that’s mounted on the `/app/studio/[[...tool]]/page.tsx` route
 */

import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'

// Go to https://www.sanity.io/docs/api-versioning to learn how API versioning works
import {apiVersion, dataset, projectId} from './sanity/env'
import {schema} from './sanity/schema'
import {serviceReadinessStructure} from './sanity/structure'
// Service Readiness A2 §8 — Studio protection for the eight protected types.
// The policy itself lives in `app/utils/studioProtection.ts` so it can be
// asserted without a browser (app/utils/__tests__/studioProtection.test.ts).
// NOTE: `__experimental_actions` was REMOVED in Sanity v5 and is inert there, so
// it is deliberately not used. Protection is `document.actions` +
// `document.newDocumentOptions` here, plus `readOnly: true` on the schema types
// and the read-only structure group in `sanity/structure.ts`.
import {protectedDocumentActions, protectedNewDocumentOptions} from './app/utils/studioProtection'

export default defineConfig({
  basePath: '/studio',
  projectId,
  dataset,
  // Add and edit the content schema in the './sanity/schema' folder
  schema,
  document: {
    // Removes every mutating action (publish/unpublish/delete/duplicate/
    // discard/restore/schedule/…) for a protected type. This resolver runs for
    // whichever document pane is open, so a hand-typed Studio URL is covered too.
    actions: protectedDocumentActions,
    // Removes protected types from every "create new" affordance.
    newDocumentOptions: protectedNewDocumentOptions,
  },
  plugins: [
    structureTool({structure: serviceReadinessStructure}),
    // Vision is a tool that lets you query your content with GROQ in the studio
    // https://www.sanity.io/docs/the-vision-plugin
    visionTool({defaultApiVersion: apiVersion}),
  ],
})
