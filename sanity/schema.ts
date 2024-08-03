import { type SchemaTypeDefinition } from 'sanity';
import { post } from './schemas/post';
import { youtubeType } from './schemas/youtubeType/youtubeType';
import { tag } from './schemas/tag';

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [post, tag],
}
