// ./schemaTypes/youTubeType/index.ts

//@note Youtube-Preview-type-schema
import { defineType, defineField } from "sanity";
import { PlayIcon } from "@sanity/icons";
import { YouTubePreview } from "./YoutubePreview";

export const youtubeType = defineType({
	name: "youtube",
	type: "object",
	title: "YouTube Embed",
	icon: PlayIcon,
	fields: [
		{
			name: "url",
			type: "url",
			title: "YouTube video URL",
		},
	],
	preview: {
		select: { title: "url" },
	},
	components: {
		preview: YouTubePreview,
	},
});
