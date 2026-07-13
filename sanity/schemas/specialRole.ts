export const specialRole = {
  name: 'special_role',
  title: 'Special Service',
  type: 'document',
  fields: [
    {
      name: "published",
      title: "Publicado",
      type: "boolean",
      initialValue: true,
      description: "Si está apagado, el servicio es un borrador visible solo para admins.",
    },
    {
      name: 'date',
      title: 'Date',
      type: 'date',
      description: 'Date of the special service',
    },
    {
      name: 'service_name',
      title: 'Service Name',
      type: 'string',
      description: 'e.g. Viernes Santo, Nochebuena, Año Nuevo',
    },
    {
      name: 'songs',
      title: 'Songs',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'setlist_song',
          fields: [
            { name: 'song', title: 'Song', type: 'reference', to: [{ type: 'post' }] },
            { name: 'play_key', type: 'string', title: 'Key to play' },
            { name: 'medley_tag', type: 'string', title: 'Medley / Mashup', hidden: true, description: 'Songs sharing the same tag are shown as a grouped medley. Managed by the setlist editor.' },
          ],
          preview: {
            select: { name: 'song.title', author: 'song.author', play_key: 'play_key' },
            prepare(selection: any) {
              const { name, play_key, author } = selection;
              return { title: name ? `${name} - ${author} [${play_key}]` : `Sin asignar` };
            },
          },
        },
      ],
    },
    {
      name: 'Lead',
      title: 'Leaders',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'teamMembers' }] }],
    },
    {
      name: 'team_notes',
      title: 'Mensaje para el equipo',
      type: 'text',
      rows: 3,
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
            select: { instrument: 'instrument', person: 'person.member_name' },
            prepare(selection: any) {
              return { title: selection.instrument || 'Sin instrumento', subtitle: selection.person || 'Sin asignar' };
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
            select: { role: 'role', person: 'person.member_name' },
            prepare(selection: any) {
              return { title: selection.role || 'Sin rol', subtitle: selection.person || 'Sin asignar' };
            },
          },
        },
      ],
    },
    {
      name: 'BGVs',
      title: 'Background Vocals',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'teamMembers' }] }],
    },
    {
      name: 'Chorus',
      title: 'Coro',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'teamMembers' }] }],
    },
  ],
  preview: {
    select: { service_name: 'service_name', date: 'date' },
    prepare(selection: any) {
      const { service_name, date } = selection;
      const formattedDate = date
        ? new Date(date.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-ES', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          })
        : 'Fecha no asignada';
      return { title: service_name || 'Servicio especial', subtitle: formattedDate };
    },
  },
};
