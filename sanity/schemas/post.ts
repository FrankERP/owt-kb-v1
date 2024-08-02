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
			name: "slug",
			title: "Slug",
			type: "slug",
			validation: (Rule: Rule) => Rule.required().error("Required"),
			options: {
				source: "title",
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
			name: "excerpt",
			title: "Excerpt",
			type: "text",
			validation: (Rule: Rule) => Rule.max(200).error("MAximum 200 characters"),
		},
		{
			name: "author",
			title: "Author",
			type: "string",
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
			name: 'test1tutorials',
			title: 'Tutorials',
			type: 'array',
			of:[
				{ type: 'url',
					title: 'EG Tutorial',
					name: 'egTutorial',
				},
				{ type: 'url',
					title: 'Piano Tutorial',
					name: 'pianoTutorial',
				},
				{ type: 'url',
					title: 'AG Tutorial',
					name: 'agTutorial',
				},
				{ type: 'url',
					title: 'Bass Tutorial',
					name: 'bassTutorial',
				},
				{ type: 'url',
					title: 'Drums Tutorial',
					name: 'drumsTutorial',
				},
			]
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
};
