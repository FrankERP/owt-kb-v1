import type { PortableTextBlock } from "@portabletext/react";
import type {
  ProposalAuthorRole,
  ProposalMessageKind,
} from "@/app/utils/proposalMessageWrite";

/**
 * A rich-text body as it comes out of Sanity, and the one source of truth for
 * that shape. `post.body` is `of: [{type:"block"}, {type:"image"}]`, so an entry
 * is a Portable Text block OR some other typed object — readers must narrow, and
 * this type makes them. `PortableTextBlock` is the same type
 * `<PortableText value={…} />` consumes, so a body typed with it goes straight
 * to the renderer instead of being cast on the way in.
 */
export type PortableTextBody = Array<PortableTextBlock | { _type: string }>;

export interface ChordChart {
  _key?: string;
  key: string;
  content: string;
}

/** A `tutorial` object in `post.tutorials2`. Neither field is required in the schema. */
export interface Tutorial {
  title?: string;
  url?: string;
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
  body: PortableTextBody;
  tutorials2: Array<Tutorial>;
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
  body: PortableTextBody;
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
  team_notes?: string;
}

export interface featuredSongs {
  songs: Array<SetlistSong>;
  week: string;
  team_notes?: string;
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
  team_notes?: string;
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
  team_notes?: string;
  admin_notes?: string;
  submitted_at?: string;
  reviewed_at?: string;
  songs?: Array<{
    _key: string;
    song: { _ref: string };
    play_key: string;
  }>;
  /**
   * Private lead <-> admin thread. Append-only; `author` is absent on migrated
   * admin notes with no attributable author. Distinct from `team_notes`, which
   * is the single message published to the whole team on approval.
   *
   * Both writers store `_type: "proposal_message"` (the schema's item name); it
   * is optional HERE because a projection is free not to select it.
   */
  messages?: Array<{
    _key: string;
    _type?: string;
    author?: { _ref: string };
    author_role: ProposalAuthorRole;
    kind: ProposalMessageKind;
    body: string;
    at: string;
  }>;
}

export interface ProposalSongItem {
  songId: string;
  play_key: string;
  title: string;
  author: string;
  key: string;
}
