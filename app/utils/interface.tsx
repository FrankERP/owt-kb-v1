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


export interface TeamMember {
  _id: string;
  name: string;
}

export interface SundayRole {
  week: string;
  Lead?: TeamMember[];
  Electric_Guitar?: TeamMember;
  Bass?: TeamMember;
  Drums?: TeamMember[];
  Keys?: TeamMember[];
  BGVs?: TeamMember[];
  Chorus?: TeamMember[];
}

export interface SetList {
  songs: SetListSong[];
  week: string;
}

export interface SetListSong {
  song: Post;
  play_key: string;
}

export interface SetListAndRoles {
  setlist: SetList;
  roles: SundayRole;
}

export interface Tag {
  name: string;
  slug: { current: string };
  _id: string;
  postCount?: number;
}


//export interface featuredSongs {
  //songs: Array<setListSongs>;  // Change from Post[] to setListSongs[]
  //week: string;
//}