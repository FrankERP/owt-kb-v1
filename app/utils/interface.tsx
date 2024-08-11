import { featuredSongs } from "@/sanity/schemas/setList";
import { Url } from "next/dist/shared/lib/router/router";

export interface Post {
	title: string;
  author: string;
	slug: { current: string };
  publishDate: string;
  excerpt: string;
  timeSig: string;
  bpm: string;
  key: string;
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

export interface setList {
  title: string;
  _id: string;
  body: any;
}

export interface featuredSongs {
  songs: Array<Post>;
  week: string;
}