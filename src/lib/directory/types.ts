/**
 * Safe public projection of an organization member for discovery and recipient selection.
 * Deliberately excludes email, auth credentials, roles, and private metadata.
 */
export interface PublicMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}
