export const saturdaySongs = {
  name: 'saturdarSongs',
  title: 'Saturday Songs',
  type: 'document',
  fields: [
    {
      name: 'songs',
      title: 'Songs',
      type: 'array',
      of: [
        {
					type: 'object',
					name: 'setlist_song',
					fields: [
            {
              name: 'song',
              title: 'Song',
              type: 'reference',
              to: [{ type: 'post' }],
            },
						{name: 'play_key', type: 'string', title: 'Key to play'},
					],
          preview: {
            select: {
              name: 'song.title',
              author: 'song.author',
              play_key:'play_key',
            },
            prepare(selection:any) {
              const {name, play_key, author} = selection;
              return {
                title: name ? `${name} - ${author} [${play_key}]` : `Sin asignar - ${play_key}`,
              };
            }
          }
				}
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
