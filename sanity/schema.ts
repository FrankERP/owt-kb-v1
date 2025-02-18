import { type SchemaTypeDefinition } from 'sanity';
import { post } from './schemas/post';
import { youtubeType } from './schemas/youtubeType/youtubeType';
import { tag } from './schemas/tag';
import { featuredSongs } from './schemas/setList';
import { saturdaySongs } from './schemas/satSongs';
import { saturdayRole } from './schemas/satRole';
import { sundayRole } from './schemas/sunRole';
import { teamMembers } from './schemas/worshipTeam';




export const schema: { types: SchemaTypeDefinition[] } = {
  types: [post, tag, featuredSongs, saturdaySongs,saturdayRole, sundayRole, teamMembers ],
}
