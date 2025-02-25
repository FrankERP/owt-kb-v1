import { Rule } from "sanity";

export const DepreciatedSaturdayRole = {
  name: 'saturday_role',
  title: 'Saturday Role',
  type: 'document',
  fields: [
    {
      name: 'week',
      title: 'Week',
      type: 'datetime',
      description: 'Week this selection is valid for',
    },
    {
      name: 'sat_team',
      title: 'Equipo',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'member',
          title: 'Miembro del Equipo',
          fields: [
            {
              name: 'person',
              title: 'Persona',
              type: 'reference',
              to: [{ type: 'teamMembers' }],
            },
            {
              name: 'role',
              title: 'Saturday Rol',
              type: 'string',
              options: {
                list: [
                  { title: 'Leader', value: 'Leader' },
                  { title: "Lead_Support", value: 'Lead Support' },
                  { title: 'EG', value: 'EG' },
                  { title: 'Bass', value: 'Bass' },
                  { title: 'Keys', value: 'Keys' },
                  { title: 'Drums', value: 'Drums' },
                  { title: 'AG', value: 'AG' },
                  { title: "BGV's", value: "BGV's" },
                ],
              },
            },
          ],
          preview: {
            select: {
              name: 'person.alias',
              role:'role',
            },
            prepare(selection:any) {
              const {name, role} = selection;
              return {
                title: name ? `${name} - ${role}` : `Sin asignar - ${role}`,
              };
            }
          }
        },
      ],
      validation: (Rule:Rule) =>
        Rule.custom((sat_team:any) => {
          if (!Array.isArray(sat_team)) return true; // Si no es un array, pasa validación.

          const rolesUnicos = ['Leader', 'Lead_Support'];
          const rolesRepetidos = new Set();

          for (const member of sat_team) {
            if (rolesUnicos.includes(member.role)) {
              if (rolesRepetidos.has(member.role)) {
                return `Solo se permite un ${member.role} en el equipo del sábado.`;
              }
              rolesRepetidos.add(member.role);
            }
          }

          return true; // Si pasa todas las verificaciones, la validación es exitosa.
        }),
    },
  ],
  preview: {
    select: {
      title: 'week',
    },
  },
};