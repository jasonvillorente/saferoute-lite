import fs from 'fs';
import path from 'path';
import { isSpotVisibleOnMap, isSpotAuthorPending } from './communitySpotUtils';
import { CommunitySpot } from '../types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('\n--- Running Community Spot Utils & Listener Safety Tests ---');

// --- Test Suite 1: isSpotVisibleOnMap ---
console.log('\nTest Suite 1: isSpotVisibleOnMap filter helper');

const baseApprovedSpot: CommunitySpot = {
  id: 'spot-1',
  title: 'Safe Walkway',
  category: 'well_lit',
  location: { lat: 14.55986, lng: 120.99925 },
  description: 'Bright lights and CCTV',
  reporterId: 'user-123',
  reporterName: 'Resident A',
  upvotes: 5,
  votedUsers: [],
  createdAt: {} as any,
  active: true,
  status: 'approved',
  approvedByAdmin: true
};

assert(isSpotVisibleOnMap(baseApprovedSpot) === true, 'Approved active spot is visible on public map');

const spotWithAdminFlagOnly: CommunitySpot = {
  ...baseApprovedSpot,
  status: undefined,
  approvedByAdmin: true,
  active: true
};
assert(isSpotVisibleOnMap(spotWithAdminFlagOnly) === true, 'Spot with approvedByAdmin: true and active: true is visible');

const pendingSpot: CommunitySpot = {
  ...baseApprovedSpot,
  id: 'spot-2',
  status: 'pending',
  active: false,
  approvedByAdmin: false
};
assert(isSpotVisibleOnMap(pendingSpot) === false, 'Pending spot is NOT visible on public map');

const rejectedSpot: CommunitySpot = {
  ...baseApprovedSpot,
  id: 'spot-3',
  status: 'rejected',
  active: false,
  approvedByAdmin: false
};
assert(isSpotVisibleOnMap(rejectedSpot) === false, 'Rejected spot is NOT visible on public map');

const inactiveApprovedSpot: CommunitySpot = {
  ...baseApprovedSpot,
  id: 'spot-4',
  active: false,
  status: 'approved'
};
assert(isSpotVisibleOnMap(inactiveApprovedSpot) === false, 'Inactive spot with status approved is NOT visible');

const missingCoordsSpot: CommunitySpot = {
  ...baseApprovedSpot,
  location: null as any
};
assert(isSpotVisibleOnMap(missingCoordsSpot) === false, 'Spot with null location is NOT visible');

const nanCoordsSpot: CommunitySpot = {
  ...baseApprovedSpot,
  location: { lat: NaN, lng: 120.999 }
};
assert(isSpotVisibleOnMap(nanCoordsSpot) === false, 'Spot with NaN latitude is NOT visible');

assert(isSpotVisibleOnMap(null) === false, 'Null spot is safely rejected');
assert(isSpotVisibleOnMap(undefined) === false, 'Undefined spot is safely rejected');


// --- Test Suite 2: isSpotAuthorPending ---
console.log('\nTest Suite 2: isSpotAuthorPending author-only preview');

const authorPendingSpot: CommunitySpot = {
  id: 'pending-1',
  title: 'My Suggested Safe Haven',
  category: 'safe_haven',
  location: { lat: 14.55845, lng: 121.00160 },
  description: 'Community pantry corner',
  reporterId: 'user-author-999',
  reporterName: 'Author Name',
  upvotes: 0,
  votedUsers: [],
  createdAt: {} as any,
  active: false,
  status: 'pending',
  approvedByAdmin: false
};

assert(
  isSpotAuthorPending(authorPendingSpot, 'user-author-999') === true,
  'Pending spot belonging to the author returns true for author-only preview'
);

assert(
  isSpotAuthorPending(authorPendingSpot, 'different-user-456') === false,
  'Pending spot does NOT return true for a different user'
);

assert(
  isSpotAuthorPending(authorPendingSpot, null) === false,
  'Pending spot returns false when no user is logged in (guest without matching id)'
);

assert(
  isSpotAuthorPending(authorPendingSpot, undefined) === false,
  'Pending spot returns false for undefined currentUserId'
);

const authorApprovedSpot: CommunitySpot = {
  ...authorPendingSpot,
  status: 'approved',
  active: true,
  approvedByAdmin: true
};
assert(
  isSpotAuthorPending(authorApprovedSpot, 'user-author-999') === false,
  'Already-approved spot does NOT return true for pending preview (rendered in main list)'
);

const authorRejectedSpot: CommunitySpot = {
  ...authorPendingSpot,
  status: 'rejected'
};
assert(
  isSpotAuthorPending(authorRejectedSpot, 'user-author-999') === false,
  'Rejected spot does NOT return true for pending preview'
);


// --- Test Suite 3: Listener Safety (No deleteDoc in Listener) ---
console.log('\nTest Suite 3: Client listener safety (no deleteDoc calls on spots)');

const mapPagePath = path.resolve(process.cwd(), 'src/pages/MapPage.tsx');
const mapPageSource = fs.readFileSync(mapPagePath, 'utf8');

// Find onSnapshot block for community_spots
const spotsListenerStart = mapPageSource.indexOf("onSnapshot(\n      collection(db, 'community_spots')");
assert(spotsListenerStart !== -1, 'Found community_spots onSnapshot listener in MapPage.tsx');

const spotsListenerEnd = mapPageSource.indexOf('handleFirestoreError(error, OperationType.GET, \'community_spots\');', spotsListenerStart);
assert(spotsListenerEnd !== -1, 'Found community_spots onSnapshot listener boundary');

const spotsListenerBlock = mapPageSource.slice(spotsListenerStart, spotsListenerEnd + 100);

assert(
  !spotsListenerBlock.includes('deleteDoc('),
  'Zero deleteDoc calls exist inside the community_spots onSnapshot listener block'
);

assert(
  !spotsListenerBlock.includes("deleteDoc(doc(db, 'community_spots'"),
  'Listener never deletes from community_spots collection'
);

assert(
  !spotsListenerBlock.includes("deleteDoc(doc(db, 'communitySpots'"),
  'Listener never deletes from communitySpots collection'
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
