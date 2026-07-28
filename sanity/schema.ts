import { type SchemaTypeDefinition } from 'sanity';
import { post } from './schemas/post';
import { youtubeType } from './schemas/youtubeType/youtubeType';
import { tag } from './schemas/tag';
import { author } from './schemas/author';
import { featuredSongs } from './schemas/setList';
import { saturdaySongs } from './schemas/satSongs';
import { saturdayRole } from './schemas/satRole';
import { sundayRole } from './schemas/sunRole';
import { teamMembers } from './schemas/worshipTeam';
import { specialRole } from './schemas/specialRole';
import { loginEvent } from './schemas/loginEvent';
import { setlistProposal } from './schemas/setlistProposal';
// Internal Service Readiness A2 coordination types — hidden/read-only, never
// authored by hand. See sanity/schemas/roleTargetLock.ts, roleCreationReceipt.ts,
// and notificationOutbox.ts.
import { roleTargetLock } from './schemas/roleTargetLock';
import { roleCreationReceipt } from './schemas/roleCreationReceipt';
import { notificationOutbox } from './schemas/notificationOutbox';

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [post, tag, author, featuredSongs, saturdaySongs, saturdayRole, sundayRole, teamMembers, specialRole, loginEvent, setlistProposal, roleTargetLock, roleCreationReceipt, notificationOutbox],
}
