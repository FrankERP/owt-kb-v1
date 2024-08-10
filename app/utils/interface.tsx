import { Url } from "next/dist/shared/lib/router/router";

export interface Post {
	title: string;
  author: string;
	slug: { current: string };
  publishDate: string;
  excerpt: string;
  body: any;
  tutorials2: Array<any>;
  lyricsURL: string;
  chordsURL: string;
  bothURL: string;
  ClickTrack: string;
  VoiceTrack: string;
  tags: Array<Tag>;
  _id: string;
}


export interface Tag {
  name: string;
  slug: { current: string };
  _id: string;
  postCount?: number;
}