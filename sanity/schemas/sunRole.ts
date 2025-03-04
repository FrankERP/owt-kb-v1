import { title } from "process";

export const sundayRole = {
  name: 'sunday_role',
  title: 'Sunday Role',
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
      title: 'Leaders',
      type: 'array',
      of: [
        {
          type: 'reference',
          to: [{ type: 'teamMembers' }], // Asumiendo que las personas están en el esquema 'teamMembers'
        },
      ],
    },
    {
      name: 'EG',
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
      lead: 'Lead',
      electricGuitar: 'EG',
      bass: 'Bass',
      drums: 'Drums',
      keys: 'Keys',
      bgvs: 'BGVs',
      chorus: 'Chorus',
    },
    prepare(selection: any) {
      const { week, lead, electricGuitar, bass, drums, keys, bgvs, chorus } = selection;
  
      if (!week) {
        return { title: 'Fecha no asignada', subtitle: 'Roles aún no definidos' };
      }
  
      let date = new Date(week);
      if (date.getDay() === 6) {
        date.setDate(date.getDate() + 1); // Move to Sunday if it's Saturday
      }
  
      const formattedDate = date.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
  
      const roles = [
        lead?.length ? `👤 Líder: ${lead.map((p: any) => p.alias).join(', ')}` : null,
        electricGuitar ? `🎸 Guitarra Eléctrica: ${electricGuitar.alias}` : null,
        bass ? `🎸 Bajo: ${bass.alias}` : null,
        drums?.length ? `🥁 Batería: ${drums.map((p: any) => p.alias).join(', ')}` : null,
        keys?.length ? `🎹 Piano/Keys: ${keys.map((p: any) => p.alias).join(', ')}` : null,
        bgvs?.length ? `🎤 BGVs: ${bgvs.map((p: any) => p.alias).join(', ')}` : null,
        chorus?.length ? `🎼 Coro: ${chorus.map((p: any) => p.alias).join(', ')}` : null,
      ].filter(Boolean); // Remove null values
  
      return {
        title: `${formattedDate}`,
        subtitle: roles.length > 0 ? roles.join(' | ') : '❌ No roles assigned yet',
      };
    }
  }
};
