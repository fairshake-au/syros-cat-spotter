// SYC-677 Task 9 (Rulings R22a, R22b): the device a cat Syros Cats made from
// a vet batch is "discovered" by. It is nobody's phone:
// - migration 0045 seeds its device_credentials row with TEAM_DESK_SECRET_HASH,
//   which no secret's hash can equal (not hex, like DELETED_SECRET_HASH), and
//   verifyDeviceSecret refuses the id by name too, so nobody can bind it;
// - the public credits it to "Syros Cats", with no spotter code, and it never
//   counts in any spotter's totals or leaderboard.
// Kept in a module of its own so deviceAuth and catHelpers can read it without
// importing the vet visit writer.

export const TEAM_DESK_DEVICE = "syros-cats-team";

/** Not hex, so it can never equal a secret's sha256 (migration 0045 writes it). */
export const TEAM_DESK_SECRET_HASH = "unbindable:syros-cats-team";

/** The name the public sees for a cat Syros Cats recorded. */
export const TEAM_DESK_NAME = "Syros Cats";

export const isTeamDesk = (deviceId: string | null | undefined): boolean => deviceId === TEAM_DESK_DEVICE;
