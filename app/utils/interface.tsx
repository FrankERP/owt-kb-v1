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
  audioTracks: Array<{ title: string; tone: string; audioFileURL: string }>;
  chordsPDF: Array<{ title: string; key: string; chordsURL: string }>;
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

export interface SetlistSong {
  _id: string;
  title: string;
  author: string;
  slug: { current: string };
  timeSig: string;
  bpm: string | number;
  key: string;
  play_key: string;
}

export interface Setlist {
  songs: Array<SetlistSong>;
  week: string;
}

export interface featuredSongs {
  songs: Array<SetlistSong>;
  week: string;
}

export interface TeamMember {
  member_name: string;
  alias?: string;
}

export interface SundayRole {
  week: string;
  Lead: Array<TeamMember>;
  instruments: Array<{ instrument: string; person: string }>;
  foh_team: Array<{ role: string; person: string }>;
  BGVs: Array<TeamMember>;
  Chorus: Array<TeamMember>;
}

export interface SaturdayRole {
  week: string;
  Lead: Array<TeamMember>;
  instruments: Array<{ instrument: string; person: string }>;
  foh_team: Array<{ role: string; person: string }>;
  BGVs: Array<TeamMember>;
  Chorus: Array<TeamMember>;
}
