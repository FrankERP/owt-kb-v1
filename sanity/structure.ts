import type { StructureResolver } from 'sanity/structure'

import {
  PROTECTED_STUDIO_TITLES,
  PROTECTED_STUDIO_TYPES,
  partitionStudioTypes,
} from '../app/utils/studioProtection'
import { apiVersion } from './env'

/**
 * Studio structure for the embedded Studio (Service Readiness A2 §8).
 *
 * The twenty protected types are removed from the DEFAULT document-type list and
 * re-offered only inside an explicitly labelled read-only inspection group, so
 * the ordinary "pick a type and edit it" path cannot reach them. Their documents
 * remain viewable — `readOnly: true` on the type makes the form non-editable and
 * `document.actions` (see `sanity.config.ts`) resolves to an empty action list,
 * so there is no mutating affordance even when a pane is reached by direct URL.
 * The one exception is `notificationOutbox`, which is delete-only: its pane is
 * how an operator finds and prunes a stray entry, which is the whole reason it
 * needs a pane at all.
 *
 * `documentList` (rather than `documentTypeList`) is used on purpose: it works
 * uniformly for the seven `hidden: true` internal types, which have no
 * `documentTypeListItem` to filter.
 */
export const serviceReadinessStructure: StructureResolver = (S) => {
  const typeItems = S.documentTypeListItems()
  const ids = typeItems.map((item) => item.getId()).filter((id): id is string => typeof id === 'string')
  const editable = new Set(partitionStudioTypes(ids).editable)

  return S.list()
    .title('Contenido')
    .items([
      // Inicio's team photo (ADR-0070) is ONE document with a fixed id: a pane,
      // not a list, so a second «Create» can never leave the page picking one of
      // two at random (`app/(client)/page.tsx` reads `_id == "homeSettings"`).
      S.listItem()
        .title('Inicio (foto del equipo)')
        .id('homeSettings')
        .child(S.document().schemaType('homeSettings').documentId('homeSettings')),
      ...typeItems.filter((item) => {
        const id = item.getId()
        return typeof id === 'string' && editable.has(id) && id !== 'homeSettings'
      }),
      S.divider(),
      S.listItem()
        .title('Servicios (solo lectura)')
        .id('serviceReadinessReadOnly')
        .child(
          S.list()
            .title('Servicios (solo lectura)')
            .items(
              PROTECTED_STUDIO_TYPES.map((type) =>
                S.listItem()
                  .title(PROTECTED_STUDIO_TITLES[type])
                  .id(`protected-${type}`)
                  .child(
                    S.documentList()
                      .title(PROTECTED_STUDIO_TITLES[type])
                      .apiVersion(apiVersion)
                      .filter('_type == $type')
                      .params({ type }),
                  ),
              ),
            ),
        ),
    ])
}
