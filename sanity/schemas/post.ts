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
			name: "excerpt",
			title: "Excerpt",
			type: "text",
			validation: (Rule: Rule) => Rule.max(200).error("MAximum 200 characters"),
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
			name: 'clickTrack',
			title: 'Rendered Multitrack with Click',
			type: 'file',
			options: {
				accept: '.mp3'
			}
		},
		{
			name: 'voiceTrack',
			title: 'Rendered Multitrack with voice',
			type: 'file',
			options: {
				accept: '.mp3'
			}
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
			name: 'chords',
			title: 'Chords pdf',
			type: 'file',
			options: {
				accept: '.pdf',
			},
		},
		{
			name: 'bothPDF',
			title: 'Cords and Lyrics pdf',
			type: 'file',
			options: {
				accept: '.pdf',
			},
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
