export const saturdaySongs = {
  name: 'saturdaySongs',
  title: 'Saturday Songs',
  type: 'document',
  fields: [
    {
      name: 'songs',
      title: 'Songs',
      type: 'array',
      of: [
        {
          type: 'reference',
          to: [{ type: 'post' }], // Asumiendo que las canciones están en el esquema 'post'
        },
      ],
    },
    {
      name: 'week',
      title: 'Week',
      type: 'datetime',
      description: 'Week this selection is valid for',
    },
  ],
  preview: {
		select: {
      title: 'week',
		},
	}
};
