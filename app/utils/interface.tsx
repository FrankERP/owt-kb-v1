export interface ChordChart {
  key: string;
  content: string;
}

export interface Post {
  _createdAt?: string;
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
  chords?: Array<ChordChart>;
  referenceLinks?: Array<{ label: string; url: string }>;
  musicalReferenceUrl?: string;
  lyricsVideoUrl?: string;
  tags: Array<Tag>;
  authors?: Array<Author>;
  _id: string;
}

export interface Tag {
  name: string;
  slug: { current: string };
  _id: string;
  postCount?: number;
}

export interface Author {
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
  medley_tag?: string;
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

export interface SpecialRole {
  _id: string;
  date: string;
  service_name: string;
  songs?: Array<SetlistSong>;
  Lead?: Array<TeamMember>;
  instruments?: Array<{ instrument: string; person: string }>;
  foh_team?: Array<{ role: string; person: string }>;
  BGVs?: Array<TeamMember>;
  Chorus?: Array<TeamMember>;
}

export interface SaturdayRole {
  week: string;
  Lead: Array<TeamMember>;
  instruments: Array<{ instrument: string; person: string }>;
  foh_team: Array<{ role: string; person: string }>;
  BGVs: Array<TeamMember>;
  Chorus: Array<TeamMember>;
}

export type ProposalStatus = "draft" | "pending" | "approved" | "changes_requested";

export interface SetlistProposal {
  _id: string;
  service_type: "sunday" | "saturday" | "special";
  service_ref: { _ref: string };
  service_date: string;
  status: ProposalStatus;
  lead_notes?: string;
  admin_notes?: string;
  submitted_at?: string;
  reviewed_at?: string;
  songs?: Array<{
    _key: string;
    song: { _ref: string };
    play_key: string;
  }>;
}

export interface ProposalSongItem {
  songId: string;
  play_key: string;
  title: string;
  author: string;
  key: string;
}
