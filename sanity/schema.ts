import { type SchemaTypeDefinition } from 'sanity';
import { post } from './schemas/post';
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
import { specialIdentityCoordinator } from './schemas/specialIdentityCoordinator';
// The shared planner rule set (P6). Hidden + read-only for the same reason the
// coordination types are: the Studio would be a second write path around the
// admin-gated route, with no `_rev` check and no `_key` minting. See
// sanity/schemas/solverConfig.ts.
import { solverConfig } from './schemas/solverConfig';
// Oasis Kids scheduling vertical (P2): pair roster + one schedule document per
// Sunday at a deterministic id. See sanity/schemas/kidsPair.ts and
// sanity/schemas/kidsSchedule.ts.
import { kidsPair } from './schemas/kidsPair';
import { kidsSchedule } from './schemas/kidsSchedule';

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [post, tag, author, featuredSongs, saturdaySongs, saturdayRole, sundayRole, teamMembers, specialRole, loginEvent, setlistProposal, roleTargetLock, roleCreationReceipt, notificationOutbox, specialIdentityCoordinator, solverConfig, kidsPair, kidsSchedule],
}
