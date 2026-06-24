import { defineType } from "sanity";

export const author = defineType({
	name: "author",
	title: "Author",
	type: "document",
	fields: [
		{
			name: "name",
			title: "Author Name",
			type: "string",
		},
		{
			name: "slug",
			title: "Slug",
			type: "slug",
			options: {
				source: "name",
				maxLength: 96,
			},
		},
	],
});
