export const sundayRole = {
  name: 'sunday_role',
  title: 'Sunday Role',
  type: 'document',
  // Service Readiness A2 §8 — Studio protection. This document is read-only in
  // the embedded Studio: every write goes through the guarded API routes, which
  // hold the target lock, assert the observed revision, and run the dependency
  // policy. `document.actions` in `sanity.config.ts` also removes every mutating
  // action (even by direct URL), and `newDocumentOptions` removes the create
  // affordance. `__experimental_actions` is NOT used — it is inert in Sanity v5.
  readOnly: true,
  fields: [
    // ── Internal (Service Readiness A2 §2) ────────────────────────────────
    // Forward link to the deterministic roleCreationReceipt that authorized this
    // document's creation. Never authored by hand; the receipt's own `roleId`
    // stays authoritative. Hidden and read-only in the Studio.
    {
      name: 'creationReceiptId',
      title: 'Creation receipt id (internal)',
      type: 'string',
      hidden: true,
      readOnly: true,
    },
    {
      name: 'creationFingerprint',
      title: 'Creation payload fingerprint (internal)',
      type: 'string',
      hidden: true,
      readOnly: true,
    },
    {
      name: "published",
      title: "Publicado",
      type: "boolean",
      initialValue: true,
      description: "Si está apagado, el servicio es un borrador visible solo para admins.",
    },
    {
      name: 'week',
      title: 'Week',
      type: 'date',
      description: 'Week this selection is valid for',
    },
    {
      name: 'Lead',
      title: 'Leaders',
      type: 'array',
      of: [
        {
          type: 'reference',
          to: [{ type: 'teamMembers' }],
        },
      ],
    },
    {
      name: 'instruments',
      title: 'Instruments',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'instrument_slot',
          fields: [
            { name: 'instrument', title: 'Instrument', type: 'string' },
            { name: 'person', title: 'Person', type: 'reference', to: [{ type: 'teamMembers' }] },
          ],
          preview: {
            select: {
              instrument: 'instrument',
              person: 'person.member_name',
            },
            prepare(selection: any) {
              const { instrument, person } = selection;
              return {
                title: instrument || 'Sin instrumento',
                subtitle: person || 'Sin asignar',
              };
            },
          },
        },
      ],
    },
    {
      name: 'foh_team',
      title: 'Front of House Team',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'foh_slot',
          fields: [
            { name: 'role', title: 'Role', type: 'string' },
            { name: 'person', title: 'Person', type: 'reference', to: [{ type: 'teamMembers' }] },
          ],
          preview: {
            select: {
              role: 'role',
              person: 'person.member_name',
            },
            prepare(selection: any) {
              const { role, person } = selection;
              return {
                title: role || 'Sin rol',
                subtitle: person || 'Sin asignar',
              };
            },
          },
        },
      ],
    },
    {
      name: 'BGVs',
      title: 'Background Vocals',
      type: 'array',
      of: [
        {
          type: 'reference',
          to: [{ type: 'teamMembers' }],
        },
      ],
    },
    {
      name: 'Chorus',
      title: 'Coro',
      type: 'array',
      of: [
        {
          type: 'reference',
          to: [{ type: 'teamMembers' }],
        },
      ],
    },
  ],
  preview: {
		select: {
      week: 'week',
		},
    prepare(selection:any) {
      const {week} = selection;
      const formattedDate = week ? new Date(week.slice(0,10) + 'T12:00:00').toLocaleDateString('es-Es', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      : 'Fecha no asignada';
      return {
        title: `${formattedDate}`,
      }
    }
	}
};
