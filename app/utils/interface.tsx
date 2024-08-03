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
  tags: Array<Tag>;
  _id: string;
}


export interface Tag {
  name: string;
  slug: { current: string };
  _id: string;
  postCount?: number;
}