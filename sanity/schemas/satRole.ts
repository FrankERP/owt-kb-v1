import { title } from "process";

export const saturdayRole = {
  name: 'saturday_role',
  title: 'Saturday Role',
  type: 'document',
  fields: [
    {
      name: 'week',
      title: 'Week',
      type: 'date',
      description: 'Week this selection is valid for',
    },
    {
      name: 'Lead',
      title: 'Lead',
      type: 'reference',
      to:[{ type: 'teamMembers' }],
    },
    {
      name: 'Lead__Support',
      title: 'Lead Support',
      type: 'reference',
      to:[{ type: 'teamMembers' }],
    },
    {
      name: 'Electric_Guitar',
      title: 'Electric Guitar',
      type: 'reference',
      to: [{ type: 'teamMembers' }], // Asumiendo que las personas están en el esquema 'teamMembers'
    },
    {
      name: 'Bass',
      title: 'Bass',
      type: 'reference',
      to: [{ type: 'teamMembers' }], // Asumiendo que las personas están en el esquema 'teamMembers'
    },
    {
      name: 'Drums',
      title: 'Batería',
      type: 'array',
      of: [
        {
          type: 'reference',
          to: [{ type: 'teamMembers' }], // Asumiendo que las personas están en el esquema 'teamMembers'
        },
      ],
    },
    {
      name: 'Keys',
      title: 'Piano/Keys',
      type: 'array',
      of: [
        {
          type: 'reference',
          to: [{ type: 'teamMembers' }], // Asumiendo que las personas están en el esquema 'teamMembers'
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
          to: [{ type: 'teamMembers' }], // Asumiendo que las personas están en el esquema 'teamMembers'
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
          to: [{ type: 'teamMembers' }], // Asumiendo que las personas están en el esquema 'teamMembers'
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
      const formattedDate = week ? new Date(week).toLocaleDateString('es-Es', {
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
