/**
 * Safe public projection of an organization member for discovery and recipient selection.
 * Deliberately excludes email, auth credentials, auth.users.id, roles, and private metadata.
 * Note: `id` is the member's stable public profile identifier (`profiles.public_id`),
 * NOT their internal authentication UUID (`auth.users.id`).
 */
export interface PublicMember {
  id: string; // profiles.public_id (opaque UUID distinct from auth.users.id)
  username: string;
  displayName: string;
  avatarUrl: string | null;
}
