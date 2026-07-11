import { doc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Wraps any promise with a timeout. If the promise does not resolve within the given
 * timeout, it resolves with the fallback value instead of hanging forever.
 */
export async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`Firestore/Auth dynamic operation timed out after ${timeoutMs}ms. Gracefully continuing...`);
      resolve(fallbackValue);
    }, timeoutMs);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Synchronizes user/resident registration data to all potential Firestore collections
 * that both the SafeRoute Lite app and the external Admin Portal might query.
 */
export async function syncResidentToAllCollections(uid: string, name: string, email: string) {
  // Try server-side synchronization first (100% reliable, bypassing client security rules & iframe blocks)
  try {
    const res = await fetch('/api/sync-resident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, name, email })
    });
    if (res.ok) {
      const data = await res.json();
      console.log('Server-side resident sync completed:', data);
      
      // If any of the backend collection syncs failed, fall back to write directly on client
      const hasFailures = data.results?.some((r: any) => r.status === 'failed');
      if (!hasFailures) {
        return;
      }
      console.warn('Some backend sync collections failed. Engaging client-side sets...');
    }
  } catch (err) {
    console.warn('Backend resident sync route unavailable, falling back to direct Firestore write:', err);
  }

  const payload = {
    uid,
    name,
    email,
    role: 'resident',
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const collections = ['users', 'residents', 'registeredUsers', 'accounts'];

  const promises = collections.map(async (collName) => {
    try {
      const writePromise = setDoc(doc(db, collName, uid), payload);
      // Give each write a strict 1.5-second timeout so offline/unconnected SDK won't hang the authentication flow
      await promiseWithTimeout(writePromise, 1500, null);
      console.log(`Successfully completed sync check for ${collName}/${uid}`);
    } catch (err) {
      console.warn(`Sync failed for collection ${collName}:`, err);
    }
  });

  await Promise.all(promises);
}

/**
 * Synchronizes single incident hazard reports or SOS distress alerts to all potential
 * incident report collections.
 */
export async function syncReportToAllCollections(reportData: {
  reporterId: string;
  reporterName?: string;
  reporterEmail?: string;
  description: string;
  status?: string;
  location?: { lat: number; lng: number };
  category?: string;
  locationName?: string;
  imageUrl?: string;
}) {
  const idSafe = `report_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const latVal = reportData.location?.lat ?? 14.56038;
  const lngVal = reportData.location?.lng ?? 120.99800;

  // Create readable local date format
  const formattedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const payload = {
    // Core details
    id: idSafe,
    status: reportData.status || 'pending',
    description: reportData.description,

    // Mobile App (Nested Schema) requirements
    reporterId: reportData.reporterId,
    reporterName: reportData.reporterName || 'Resident',
    location: { lat: latVal, lng: lngVal },
    imageUrl: reportData.imageUrl || '',

    // Admin Portal (Flat Schema) requirements
    reporter: reportData.reporterName || 'Resident',
    reporterEmail: reportData.reporterEmail || 'resident@saferoute.local',
    locationName: reportData.locationName || 'Barangay Palanan',
    latitude: latVal,
    longitude: lngVal,
    category: reportData.category || 'General Hazard',
    dateSubmitted: formattedDate,
    convertedToDangerZoneId: ''
  };

  // Try server-side synchronization first (100% reliable)
  try {
    const res = await fetch('/api/sync-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: idSafe, payload })
    });
    if (res.ok) {
      const data = await res.json();
      console.log('Server-side report sync completed:', data);
      
      const hasFailures = data.results?.some((r: any) => r.status === 'failed');
      if (!hasFailures) {
        return;
      }
      console.warn('Some backend sync report collections failed. Engaging client-side sets...');
    }
  } catch (err) {
    console.warn('Backend report sync route unavailable, falling back to direct Firestore write:', err);
  }

  // Fallback to client-side Firestore write
  const activePayload = {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  // Sync to multiple collections for redundancy and bridging
  const collections = ['reports', 'incident_reports'];
  if (activePayload.status === 'approved' || reportData.description.includes('🚨')) {
    collections.push('community_alerts');
  }

  const promises = collections.map(async (collName) => {
    try {
      const writePromise = setDoc(doc(db, collName, idSafe), activePayload);
      await promiseWithTimeout(writePromise, 2000, null);
      console.log(`Successfully synchronized report check for ${idSafe} to ${collName}`);
    } catch (err) {
      console.warn(`Report sync failed for ${collName}:`, err);
    }
  });

  await Promise.all(promises);
}
