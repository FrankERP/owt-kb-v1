export interface Post {
	title: string;
	slug: { current: string };
  publishDate: string;
  excerpt: string;
  body: any;
  tags: Array<Tag>;
  _id: string;
}


export interface Tag {
  name: string;
  slug: { current: string };
  _id: string;
  postCount?: number;
}