import { CommunitySpot } from '../types';

/**
 * Determines if a community spot should be publicly visible on the map and counted in the panel badge.
 * A spot is publicly visible ONLY if:
 * 1. It has valid numeric latitude and longitude coordinates.
 * 2. It is marked active.
 * 3. Its status is 'approved' or approvedByAdmin is true.
 * 4. Its status is NOT 'pending' and NOT 'rejected'.
 */
export function isSpotVisibleOnMap(spot: CommunitySpot | null | undefined): boolean {
  if (!spot) return false;
  if (!spot.location) return false;

  const { lat, lng } = spot.location;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;

  if (spot.status === 'rejected' || spot.status === 'pending') {
    return false;
  }

  const isApproved = spot.status === 'approved' || spot.approvedByAdmin === true;
  const isActive = spot.active === true || (spot as any).active === 'true';

  return Boolean(isActive && isApproved);
}

/**
 * Determines if a community spot should be displayed as an author-only pending preview.
 * This allows the author of a suggested spot to see their submission on the map with
 * a dashed border and 'Under review' badge while awaiting admin review.
 */
export function isSpotAuthorPending(spot: CommunitySpot | null | undefined, currentUserId?: string | null): boolean {
  if (!spot || !currentUserId) return false;
  if (!spot.location) return false;

  const { lat, lng } = spot.location;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;

  // Never show rejected spots in active preview
  if (spot.status === 'rejected') return false;

  // Must belong to the current user
  if (!spot.reporterId || spot.reporterId !== currentUserId) {
    return false;
  }

  // Must be pending / not yet approved
  const isPending = spot.status === 'pending' || !spot.active || spot.approvedByAdmin === false;
  return Boolean(isPending);
}
