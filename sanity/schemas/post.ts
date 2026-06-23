import { title } from "process";
import { Rule } from "sanity";

export const post = {
	name: "post",
	title: "Post",
	type: "document",

	fields: [
		{
			name: "title",
			title: "Title",
			type: "string",
			validation: (Rule: Rule) => Rule.required().error("Required"),
		},
		{
			name: "author",
			title: "Author",
			type: "string",
		},
		{
			name: "slug",
			title: "Slug",
			type: "slug",
			validation: (Rule: Rule) => Rule.required().error("Required"),
			options: {
				source: (doc:any) => `${doc.title}-${doc.author}`,
				maxLength: 96,
			},
		},
		{
			name: "publishDate",
			title: "Published at",
			type: "datetime",
			initialValue: () => new Date().toISOString(),
		},
		{
			name: 'timeSig',
			title: 'Time Signature',
			type: 'string',
		},
		{
			name: 'bpm',
			title: 'BPM',
			type: 'number',
		},
		{
			name: 'key',
			title: 'Key',
			type: 'string',
		},
		{
			name: 'musicalReferenceUrl',
			title: 'Musical reference (URL)',
			description: 'YouTube musical reference mix — what musicians rehearse with.',
			type: 'url',
		},
		{
			name: 'lyricsVideoUrl',
			title: 'Spanish lyrics video (URL)',
			description: 'YouTube video with the Spanish lyrics the team sings. Optional.',
			type: 'url',
		},
		{
			name: "body",
			title: "Body",
			type: "array",
			of: [
				{ type: "block" },
				{
					type: "image",
					fields: [{ type: "text", name: "alt", title: "Alt" }],
				},
			],
		},
		{
			name: 'tutorials2',
			title: 'Tutorials',
			type: 'array',
			of: [
				{
					type: 'object',
					name: 'tutorial',
					fields: [
						{name: 'title', type: 'string', title: 'Title'},
						{name: 'url', type: 'url', title: 'URL'},
					]
				}
			]
		},
		{
			name: 'audioTracks',
			title: 'Audio Tracks',
			type: 'array',
			of: [
				{
					type: 'object',
					name: 'audioTrack',
					fields: [
						{ name: 'title', type: 'string', title: 'Title' }, // Ej: "Canción sin voz", "Canción con voz principal"
						{ name: 'tone', type: 'string', title: 'Tone' }, // Ej: "C", "D", "E", etc.
						{ name: 'audioFile', type: 'file', title: 'Audio File', options: { accept: '.mp3' } },
					]
				}
			]
		},
		{
			name: 'lyrics',
			title: 'Lyrics pdf',
			type: 'file',
			options: {
				accept: '.pdf',
			},
		},
		{
			name: 'chordsPDF',
			title: 'chords pdf',
			type: 'array',
			of: [
				{
					type: 'object',
					name: 'chordsPDF',
					fields: [
						{name: 'title', type: 'string', title: 'Title'},
						{name: 'key', type: 'string', title: 'Key'},
						{name: 'chordsPDF', type: 'file', title: 'Chords PDF', options: { accept: '.pdf' }},
					]
				}
			]
		},
		{
			name: 'chords',
			title: 'Chord Charts',
			description: 'Written chord charts per key. Plain text — write chords above each lyric line.',
			type: 'array',
			of: [
				{
					type: 'object',
					name: 'chord_chart',
					fields: [
						{
							name: 'key',
							title: 'Key',
							type: 'string',
							description: 'E.g. C, Am, Bb',
						},
						{
							name: 'content',
							title: 'Chart',
							type: 'text',
							rows: 20,
							description: 'Write chords above the lyrics, one line at a time.',
						},
					],
					preview: {
						select: { key: 'key' },
						prepare(sel: { key?: string }) {
							return { title: sel.key ? `Acordes — ${sel.key}` : 'Sin tonalidad' };
						},
					},
				},
			],
		},
		{
			name: "referenceLinks",
			title: "Reference Links",
			type: "array",
			of: [
				{
					type: "object",
					name: "referenceLink",
					fields: [
						{ name: "label", type: "string", title: "Label" },
						{ name: "url",   type: "url",    title: "URL"   },
					],
				},
			],
		},
		{
			name: "tags",
			title: "Tags",
			type: "array",
			of: [
				{
					type: "reference",
					to: [
						{
							type: "tag",
						},
					],
				},
			],
		},
	],

	preview: {
		select: {
			title: "title",
			author: "author",
		},
		prepare(selection:any) {
			const {title, author} = selection;
			return {
				title: `${title} - ${author}`,
			};
		}
	}

};
