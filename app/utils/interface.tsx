import { Url } from "next/dist/shared/lib/router/router";

export interface Post {
	title: string;
  author: string;
	slug: { current: string };
  publishDate: string;
  excerpt: string;
  body: any;
  tutorials: Array<object>;
  lyrics: File;
  chords: File;
  bothPDF: File;
  lyricsURL: string;
  chordsURL: string;
  bothURL: string;
  tags: Array<Tag>;
  _id: string;
}


export interface Tag {
  name: string;
  slug: { current: string };
  _id: string;
  postCount?: number;
}