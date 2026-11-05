import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  addDoc, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  Timestamp 
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ipRateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkIpRateLimit(ip: string, maxRequests = 20, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = ipRateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    ipRateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count++;
  return true;
}

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware - Support larger payloads for hazard photo attachments & batch syncs
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // CORS configuration for web browsers and packaged Capacitor mobile applications (Android/iOS)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
      'https://localhost',
      'http://localhost',
      'capacitor://localhost',
      'ionic://localhost'
    ];

    if (process.env.APP_URL) {
      try {
        const appUrlOrigin = new URL(process.env.APP_URL).origin;
        if (!allowedOrigins.includes(appUrlOrigin)) allowedOrigins.push(appUrlOrigin);
      } catch {}
    }

    if (origin) {
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.run.app') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')
      ) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Load Firebase Application credentials from firebase-applet-config.json
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  let db: any = null;

  try {
    if (fs.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const firebaseApp = initializeApp(firebaseConfig);
      db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
        ? getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId)
        : getFirestore(firebaseApp);
      console.log('Firebase initialized on Express backend successfully!');
      
      // Auto-seed database if empty to recover danger zones, reports, and simulated accounts
      initializeDatabaseSeeding(db);
    } else {
      console.warn('Warning: firebase-applet-config.json not found. Backend running in partial mock mode.');
    }
  } catch (err) {
    console.error('Failed to initialize Firebase on backend:', err);
  }

  // --- API ROUTES ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', firebaseConnected: !!db });
  });

  // OpenRouteService Proxy API: Avoid-polygons routing with server-side API key
  // Hardened with IP rate limiting, study-area bounds checks, polygon caps, and 3 km max distance.
  app.post('/api/directions/ors', async (req, res) => {
    const apiKey = process.env.OPENROUTESERVICE_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'OPENROUTESERVICE_KEY not configured', disabled: true });
    }

    // 1. Rate limiting per IP: maximum 20 requests per minute
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!checkIpRateLimit(clientIp, 20, 60000)) {
      console.warn(`[ORS Proxy] Rate limit exceeded for IP: ${clientIp}`);
      return res.status(429).json({ error: 'Rate limit exceeded: maximum 20 requests per minute.' });
    }

    const { coordinates, avoidPolygons } = req.body;

    // 2. Coordinates validation: exactly 2 points [start, end]
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ error: 'Invalid coordinates: array of exactly 2 points [origin, destination] required.' });
    }

    for (const pt of coordinates) {
      if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number' || isNaN(pt[0]) || isNaN(pt[1])) {
        return res.status(400).json({ error: 'Invalid coordinate values: each point must contain [longitude, latitude].' });
      }
    }

    // Coordinates in GeoJSON are [longitude, latitude]
    const startLng = coordinates[0][0];
    const startLat = coordinates[0][1];
    const endLng = coordinates[1][0];
    const endLat = coordinates[1][1];

    // 3. Study-area bounds validation: coordinates must reside within Barangay Palanan (with margin for road snapping)
    // Palanan bounds: lat 14.5510 - 14.5680, lng 120.9900 - 121.0080
    const MIN_LAT = 14.5490;
    const MAX_LAT = 14.5700;
    const MIN_LNG = 120.9880;
    const MAX_LNG = 121.0100;

    if (
      startLat < MIN_LAT || startLat > MAX_LAT || startLng < MIN_LNG || startLng > MAX_LNG ||
      endLat < MIN_LAT || endLat > MAX_LAT || endLng < MIN_LNG || endLng > MAX_LNG
    ) {
      return res.status(400).json({ error: 'Coordinates must be located within the Barangay Palanan study-area bounds.' });
    }

    // 4. Maximum route distance validation: maximum 3 km
    const directDistanceMeters = haversineDistanceMeters(startLat, startLng, endLat, endLng);
    if (directDistanceMeters > 3000) {
      return res.status(400).json({ error: 'Route distance exceeds maximum limit of 3 km.' });
    }

    // 5. Avoid polygons validation: at most 1 polygon set, maximum 10 polygons, each maximum 64 vertices
    if (avoidPolygons !== undefined && avoidPolygons !== null) {
      if (!Array.isArray(avoidPolygons)) {
        return res.status(400).json({ error: 'avoidPolygons must be an array.' });
      }
      if (avoidPolygons.length > 10) {
        return res.status(400).json({ error: 'Maximum of 10 avoid polygons permitted.' });
      }

      for (let pIdx = 0; pIdx < avoidPolygons.length; pIdx++) {
        const poly = avoidPolygons[pIdx];
        if (!Array.isArray(poly) || poly.length === 0) {
          return res.status(400).json({ error: `Polygon at index ${pIdx} is invalid.` });
        }
        const exteriorRing = poly[0];
        if (!Array.isArray(exteriorRing) || exteriorRing.length === 0) {
          return res.status(400).json({ error: `Polygon ring at index ${pIdx} is empty.` });
        }
        if (exteriorRing.length > 64) {
          return res.status(400).json({ error: `Polygon at index ${pIdx} exceeds 64 vertices limit (${exteriorRing.length} vertices).` });
        }
        for (const vertex of exteriorRing) {
          if (!Array.isArray(vertex) || vertex.length !== 2 || typeof vertex[0] !== 'number' || typeof vertex[1] !== 'number') {
            return res.status(400).json({ error: `Invalid vertex coordinate in polygon at index ${pIdx}.` });
          }
        }
      }
    }

    const body: any = {
      coordinates
    };

    if (avoidPolygons && Array.isArray(avoidPolygons) && avoidPolygons.length > 0) {
      body.options = {
        avoid_polygons: {
          type: 'MultiPolygon',
          coordinates: avoidPolygons
        }
      };
    }

    const startTime = Date.now();
    console.log(`[ORS Proxy] Live call initiating for IP ${clientIp} (coords: [${startLat.toFixed(5)}, ${startLng.toFixed(5)}] -> [${endLat.toFixed(5)}, ${endLng.toFixed(5)}], avoidPolygons: ${avoidPolygons?.length || 0})`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const orsResponse = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', {
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const elapsed = Date.now() - startTime;
      const polygonSummary = avoidPolygons && Array.isArray(avoidPolygons)
        ? `${avoidPolygons.length} polygons (${avoidPolygons.map((p: any) => p[0]?.length || 0).join(', ')} vertices)`
        : '0 polygons';

      if (!orsResponse.ok) {
        const errText = await orsResponse.text();
        let parsedError: any = null;
        try {
          parsedError = JSON.parse(errText);
        } catch {}

        // Never log or return the API key
        console.warn(`[ORS Proxy] LIVE OpenRouteService error status ${orsResponse.status} in ${elapsed}ms. Error body: ${errText.substring(0, 300)}. Sent request: coords=${JSON.stringify(coordinates)}, polygons=${polygonSummary}`);

        return res.status(orsResponse.status).json({
          error: parsedError?.error?.message || `OpenRouteService request failed with status ${orsResponse.status}`,
          code: parsedError?.error?.code || null,
          orsError: parsedError?.error || null,
          status: orsResponse.status
        });
      }

      console.log(`[ORS Proxy] LIVE OpenRouteService status 200 in ${elapsed}ms. Sent request: coords=${JSON.stringify(coordinates)}, polygons=${polygonSummary}`);
      const data = await orsResponse.json();
      return res.json(data);
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      console.warn(`[ORS Proxy] Request failed in ${elapsed}ms:`, err.message || 'Unknown network error');
      return res.status(500).json({ error: err.message || 'ORS request failed' });
    }
  });

  // SERVER-SIDE SYNC API: Resident Synchronization across all central collections
  app.post('/api/sync-resident', async (req, res) => {
    try {
      const { uid, name, email, phoneNumber, phone, mobileNumber, authMethod, authProvider } = req.body;
      const cleanPhone = (phoneNumber || phone || mobileNumber || '').trim();
      const isPhone = authMethod === 'phone' || authProvider === 'phone' || !!cleanPhone || (email && (email.includes('@phone.') || email.endsWith('.saferoute.ph')));
      const resolvedAuthMethod = authMethod || (isPhone ? 'phone' : (email ? 'email' : 'phone'));
      const cleanEmail = email || (cleanPhone ? `${cleanPhone.replace(/[^0-9]/g, '')}@phone.saferoute.ph` : '');

      if (!uid) {
        return res.status(400).json({ error: 'Missing uid field.' });
      }

      if (db) {
        const payload: any = {
          uid,
          name: name || (cleanPhone ? `Resident (${cleanPhone})` : 'Anonymous Resident'),
          email: cleanEmail,
          role: 'resident',
          status: 'active',
          authMethod: resolvedAuthMethod,
          authProvider: resolvedAuthMethod,
          provider: resolvedAuthMethod,
          authType: resolvedAuthMethod,
          isPhoneAuth: resolvedAuthMethod === 'phone',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        if (isPhone) {
          payload.phoneBridgeEmail = cleanEmail;
        }

        if (cleanPhone) {
          payload.phoneNumber = cleanPhone;
          payload.phone = cleanPhone;
          payload.mobileNumber = cleanPhone;
        }

        const collections = ['users', 'residents', 'registeredUsers', 'accounts'];
        const results = [];

        for (const collName of collections) {
          try {
            await setDoc(doc(db, collName, uid), payload, { merge: true });
            results.push({ collection: collName, status: 'synced' });
          } catch (e: any) {
            console.error(`Backend sync failed for ${collName}/${uid}:`, e.message);
            results.push({ collection: collName, status: 'failed', error: e.message });
          }
        }

        return res.json({ success: true, uid, results });
      } else {
        return res.json({ success: true, message: 'Mock Sync Successfully', uid });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SERVER-SIDE SYNC API: Incident Report / Distress synchronization
  app.post('/api/sync-report', async (req, res) => {
    try {
      const { reportId, payload } = req.body;
      if (!reportId || !payload) {
        return res.status(400).json({ error: 'Missing reportId or payload fields.' });
      }

      if (db) {
        const enrichedPayload = {
          ...payload,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        const collections = ['reports', 'incident_reports', 'activity_logs'];
        const results = [];

        for (const collName of collections) {
          try {
            await setDoc(doc(db, collName, reportId), enrichedPayload);
            results.push({ collection: collName, status: 'synced' });
          } catch (e: any) {
            console.error(`Backend sync failed for report ${collName}/${reportId}:`, e.message);
            results.push({ collection: collName, status: 'failed', error: e.message });
          }
        }

        return res.json({ success: true, reportId, results });
      } else {
        return res.json({ success: true, message: 'Mock Sync Successfully', reportId });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AUTH API: Register Profile
  app.post('/api/register', async (req, res) => {
    try {
      const { uid, name, email, phoneNumber, phone, role, authMethod } = req.body;
      if (!uid) {
        return res.status(400).json({ error: 'Missing uid field.' });
      }

      const cleanPhone = (phoneNumber || phone || '').trim();
      const isPhone = authMethod === 'phone' || !!cleanPhone || (email && (email.includes('@phone.') || email.endsWith('.saferoute.ph')));
      const resolvedAuthMethod = authMethod || (isPhone ? 'phone' : (email ? 'email' : 'phone'));
      const cleanEmail = email || (cleanPhone ? `${cleanPhone.replace(/[^0-9]/g, '')}@phone.saferoute.ph` : '');

      if (db) {
        // Persist User Profile directly in Firestore
        const userDocData: any = {
          name: name || (cleanPhone ? `Resident (${cleanPhone})` : 'Anonymous User'),
          email: cleanEmail,
          role: role || 'resident',
          authMethod: resolvedAuthMethod,
          authProvider: resolvedAuthMethod,
          provider: resolvedAuthMethod,
          authType: resolvedAuthMethod,
          isPhoneAuth: resolvedAuthMethod === 'phone',
          createdAt: Timestamp.now()
        };
        if (isPhone) {
          userDocData.phoneBridgeEmail = cleanEmail;
        }
        if (cleanPhone) {
          userDocData.phoneNumber = cleanPhone;
          userDocData.phone = cleanPhone;
          userDocData.mobileNumber = cleanPhone;
        }

        await setDoc(doc(db, 'users', uid), userDocData, { merge: true });
        return res.json({ message: 'User registered successfully inside Firestore.', uid });
      } else {
        return res.json({ message: 'User registered (Mock Mode)', uid });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AUTH API: Login Profile (Auxiliary logger endpoint)
  app.post('/api/login', async (req, res) => {
    try {
      const { email, phoneNumber } = req.body;
      res.json({ message: 'Login event tracked successfully on API endpoint.', email, phoneNumber });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AUTH API: Lookup Resident by Phone or Email
  app.post('/api/lookup-resident', async (req, res) => {
    try {
      const { identifier } = req.body; // Can be email or phone number
      if (!identifier) {
        return res.status(400).json({ error: 'Missing identifier parameter' });
      }

      if (db) {
        const cleanIdent = identifier.trim();
        const cleanDigits = cleanIdent.replace(/[^0-9]/g, '');

        // Query across users and residents collection
        const colls = ['users', 'residents'];
        for (const coll of colls) {
          const snap = await getDocs(collection(db, coll));
          for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const docEmail = (data.email || '').toLowerCase();
            const docPhone = (data.phoneNumber || data.phone || data.mobileNumber || '').replace(/[^0-9]/g, '');

            if (
              (docEmail && docEmail === cleanIdent.toLowerCase()) ||
              (cleanDigits.length >= 7 && docPhone && docPhone.includes(cleanDigits)) ||
              (cleanDigits.length >= 7 && docEmail && docEmail.includes(cleanDigits))
            ) {
              return res.json({
                found: true,
                uid: docSnap.id,
                name: data.name || 'Resident',
                email: data.email || `${cleanDigits}@phone.saferoute.ph`,
                phoneNumber: data.phoneNumber || data.phone || cleanIdent,
                role: data.role || 'resident',
                createdAt: data.createdAt
              });
            }
          }
        }
      }

      return res.json({ found: false });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AUTH API: Delete User Account
  app.post('/api/delete-account', async (req, res) => {
    try {
      const { uid, email } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ error: 'Missing uid or email for account deletion.' });
      }

      if (db) {
        const collections = ['users', 'residents', 'registeredUsers', 'accounts'];
        const deletionResults = [];
        for (const collName of collections) {
          try {
            if (uid) {
              await deleteDoc(doc(db, collName, uid));
              deletionResults.push({ collection: collName, status: 'deleted' });
            }
          } catch (e: any) {
            deletionResults.push({ collection: collName, status: 'failed', error: e.message });
          }
        }
        return res.json({ success: true, message: 'User account records removed from database.', results: deletionResults });
      } else {
        return res.json({ success: true, message: 'User account removed (Sandbox Mode)' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AUTH API: Save Privacy Settings
  app.post('/api/user-privacy', async (req, res) => {
    try {
      const { uid, privacySettings } = req.body;
      if (!uid) {
        return res.status(400).json({ error: 'Missing uid.' });
      }
      if (db) {
        await updateDoc(doc(db, 'users', uid), {
          privacySettings,
          updatedAt: Timestamp.now()
        }).catch(async () => {
          await setDoc(doc(db, 'users', uid), {
            privacySettings,
            updatedAt: Timestamp.now()
          }, { merge: true });
        });
        return res.json({ success: true, message: 'Privacy settings saved to cloud.' });
      } else {
        return res.json({ success: true, message: 'Privacy settings saved (Sandbox Mode)' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DANGER ZONES: GET
  app.get('/api/dangerzones', async (req, res) => {
    try {
      if (db) {
        const q = collection(db, 'danger_zones');
        const snapshot = await getDocs(q);
        const zones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(zones);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DANGER ZONES: POST
  app.post('/api/dangerzones', async (req, res) => {
    try {
      const { location, latitude, longitude, lat, lng, radius, description, addedBy, active } = req.body;
      
      // Resolve location coordinates in both nested and flat forms
      let finalLocation = null;
      let finalLat = null;
      let finalLng = null;

      if (location && typeof location === 'object') {
        const lLat = location.lat !== undefined ? Number(location.lat) : Number(location.latitude);
        const lLng = location.lng !== undefined ? Number(location.lng) : Number(location.longitude);
        if (!isNaN(lLat) && !isNaN(lLng)) {
          finalLocation = { lat: lLat, lng: lLng };
          finalLat = lLat;
          finalLng = lLng;
        }
      }

      if (!finalLocation) {
        const reqLat = latitude !== undefined ? latitude : lat;
        const reqLng = longitude !== undefined ? longitude : lng;
        if (reqLat !== undefined && reqLng !== undefined) {
          const pLat = Number(reqLat);
          const pLng = Number(reqLng);
          if (!isNaN(pLat) && !isNaN(pLng)) {
            finalLocation = { lat: pLat, lng: pLng };
            finalLat = pLat;
            finalLng = pLng;
          }
        }
      }

      if (!finalLocation || radius === undefined || isNaN(Number(radius))) {
        return res.status(400).json({ error: 'Missing core location (lat/lng or coordinates) or radius fields' });
      }

      if (db) {
        const docRef = await addDoc(collection(db, 'danger_zones'), {
          location: finalLocation,
          latitude: finalLat,
          longitude: finalLng,
          radius: Number(radius),
          description: description || 'No description provided.',
          addedBy: addedBy || 'system',
          createdAt: Timestamp.now(),
          active: active !== undefined ? (typeof active === 'string' ? active === 'true' : !!active) : true
        });
        res.json({ id: docRef.id, message: 'Danger zone logged successfully.' });
      } else {
        res.json({ id: 'mock-zone-id', message: 'Danger zone logged in Mock mode.' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DANGER ZONES: PUT
  app.put('/api/dangerzones/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const dataToUpdate = req.body;

      if (db) {
        await updateDoc(doc(db, 'danger_zones', id), dataToUpdate);
        res.json({ message: `Danger zone ${id} updated successfully.` });
      } else {
        res.json({ message: `Danger zone ${id} updated (Mock Mode).` });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DANGER ZONES: DELETE
  app.delete('/api/dangerzones/:id', async (req, res) => {
    try {
      const { id } = req.params;

      if (db) {
        await deleteDoc(doc(db, 'danger_zones', id));
        res.json({ message: `Danger zone ${id} deleted successfully.` });
      } else {
        res.json({ message: `Danger zone ${id} deleted (Mock Mode).` });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // COMMUNITY SPOTS: GET
  app.get('/api/communityspots', async (req, res) => {
    try {
      if (db) {
        const q = collection(db, 'community_spots');
        const snapshot = await getDocs(q);
        const spots = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(spots);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // COMMUNITY SPOTS: POST
  app.post('/api/communityspots', async (req, res) => {
    try {
      const { title, category, location, description, reporterId, reporterName } = req.body;
      if (!title || !location || !category) {
        return res.status(400).json({ error: 'Missing title, category, or location.' });
      }

      if (db) {
        const payload = {
          title,
          category: category || 'safe_haven',
          location: {
            lat: Number(location.lat),
            lng: Number(location.lng)
          },
          description: description || 'Resident pinpointed safe community location.',
          reporterId: reporterId || 'resident',
          reporterName: reporterName || 'Community Member',
          upvotes: 0,
          votedUsers: [],
          active: false,
          status: 'pending',
          approvedByAdmin: false,
          createdAt: Timestamp.now()
        };

        const docRef = await addDoc(collection(db, 'community_spots'), payload);
        // Also sync to camelCase collection for external admin compatibility
        await setDoc(doc(db, 'communitySpots', docRef.id), payload);

        res.json({ id: docRef.id, message: 'Community spot posted successfully.' });
      } else {
        res.json({ id: 'mock-spot-id', message: 'Community spot logged (Mock Mode).' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // COMMUNITY SPOTS: UPVOTE
  app.post('/api/communityspots/:id/upvote', async (req, res) => {
    try {
      const { id } = req.params;
      const { userId } = req.body;
      if (db) {
        const spotRef = doc(db, 'community_spots', id);
        const spotDoc = await getDoc(spotRef);
        if (spotDoc.exists()) {
          const spotData = spotDoc.data();
          const voted = spotData.votedUsers || [];
          if (!voted.includes(userId)) {
            const newVoted = [...voted, userId];
            const newUpvotes = (spotData.upvotes || 0) + 1;
            await updateDoc(spotRef, { upvotes: newUpvotes, votedUsers: newVoted });
            // Sync to secondary
            try {
              await updateDoc(doc(db, 'communitySpots', id), { upvotes: newUpvotes, votedUsers: newVoted });
            } catch (e) { /* ignore secondary sync error */ }
            return res.json({ success: true, upvotes: newUpvotes });
          }
          return res.json({ success: true, upvotes: spotData.upvotes, message: 'Already upvoted' });
        }
      }
      res.json({ success: true, message: 'Upvoted (Mock)' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // COMMUNITY SPOTS: UPDATE (Approve / Edit / Pinpoint)
  app.put('/api/communityspots/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const dataToUpdate = { ...req.body };
      if (dataToUpdate.status === 'approved' || dataToUpdate.status === 'active' || dataToUpdate.active === true || dataToUpdate.active === 'true') {
        dataToUpdate.status = 'approved';
        dataToUpdate.active = true;
        dataToUpdate.approvedByAdmin = true;
      }
      if (db) {
        await updateDoc(doc(db, 'community_spots', id), dataToUpdate);
        try {
          await updateDoc(doc(db, 'communitySpots', id), dataToUpdate);
        } catch (e) {}
        return res.json({ success: true, message: `Community spot ${id} updated.` });
      }
      res.json({ success: true, message: 'Updated (Mock)' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // COMMUNITY SPOTS: DELETE (Reject / Remove)
  app.delete('/api/communityspots/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (db) {
        await deleteDoc(doc(db, 'community_spots', id));
        try {
          await deleteDoc(doc(db, 'communitySpots', id));
        } catch (e) {}
        return res.json({ success: true, message: `Community spot ${id} deleted.` });
      }
      res.json({ success: true, message: 'Deleted (Mock)' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // REPORTS: GET
  app.get('/api/reports', async (req, res) => {
    try {
      if (db) {
        const q = collection(db, 'reports');
        const snapshot = await getDocs(q);
        const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(reports);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // REPORTS: POST
  app.post('/api/reports', async (req, res) => {
    try {
      const { reporterId, location, description, status } = req.body;
      if (!location || !description) {
        return res.status(400).json({ error: 'Missing location and description.' });
      }

      if (db) {
        const docRef = await addDoc(collection(db, 'reports'), {
          reporterId: reporterId || 'system',
          location,
          description,
          status: status || 'pending',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
        res.json({ id: docRef.id, message: 'Incident report filed successfully.' });
      } else {
        res.json({ id: 'mock-report-id', message: 'Report logged (Mock Mode).' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // REPORTS: DELETE
  app.delete('/api/reports/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (db) {
        const reportCollections = ['reports', 'incident_reports', 'activity_logs'];
        for (const coll of reportCollections) {
          try {
            await deleteDoc(doc(db, coll, id));
          } catch (e) {}
        }
        res.json({ success: true, message: `Report ${id} deleted across all collections.` });
      } else {
        res.json({ success: true, message: 'Report deleted (Mock Mode).' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PURGE TEST / DUMMY REPORTS
  app.post('/api/purge-test-reports', async (req, res) => {
    try {
      if (db) {
        const reportCollections = ['reports', 'incident_reports', 'activity_logs'];
        let deletedCount = 0;
        for (const coll of reportCollections) {
          const snap = await getDocs(collection(db, coll));
          for (const docSnap of snap.docs) {
            await deleteDoc(doc(db, coll, docSnap.id));
            deletedCount++;
          }
        }
        res.json({ success: true, message: `Purged ${deletedCount} records across collections.` });
      } else {
        res.json({ success: true, message: 'Purged (Mock Mode).' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // NOTIFICATIONS: GET
  app.get('/api/notifications', async (req, res) => {
    try {
      if (db) {
        const q = collection(db, 'notifications');
        const snapshot = await getDocs(q);
        const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(notifications);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // NOTIFICATIONS: POST
  app.post('/api/notifications', async (req, res) => {
    try {
      const { userId, message, type } = req.body;
      if (!userId || !message) {
        return res.status(400).json({ error: 'Missing userId or message details.' });
      }

      if (db) {
        const docRef = await addDoc(collection(db, 'notifications'), {
          userId,
          message,
          type: type || 'alert',
          read: false,
          createdAt: Timestamp.now()
        });
        res.json({ id: docRef.id, message: 'Notification broadcasted successfully.' });
      } else {
        res.json({ id: 'mock-notif-id', message: 'Notification broadcasted (Mock Mode).' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- VITE DEV MIDDLEWARE AND STATIC SERVING ---

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express server running on http://0.0.0.0:${PORT}`);
  });
}

// Automatic Seeding helper for fresh/empty databases to populate danger zones & default users
async function initializeDatabaseSeeding(db: any) {
  try {
    console.log('[Seeding] checking if database needs seeding...');
    
    // 1. Seed Danger Zones - Disabled as requested to prevent re-creating unnecessary danger zones
    console.log('[Seeding] Skipping default danger zones seeding.');

    // 2. Seed default users to user collection to register them in Admin Portal immediately
    const qUsers = collection(db, 'users');
    const snapshotUsers = await getDocs(qUsers);
    if (snapshotUsers.empty) {
      console.log('[Seeding] users collection is empty! Seeding default tenant/resident profiles...');
      const seedUsers = [
        {
          uid: "hsbE2Zk8claf05LPSoJvaUMDY0P2",
          name: "Zed Dela Cruz",
          email: "zed@gmail.com",
          role: "resident",
          status: "active"
        },
        {
          uid: "user_seed_001",
          name: "Maria Clara",
          email: "maria.clara@gmail.com",
          role: "resident",
          status: "active"
        },
        {
          uid: "OMFPgBOB21X8Rd7WwUBUr3A3iFL2",
          name: "SafeRoute Administrator",
          email: "admin@gmail.com",
          role: "admin",
          status: "active"
        }
      ];

      const syncCollections = ['users', 'residents', 'registeredUsers', 'accounts'];
      for (const u of seedUsers) {
        const payload = {
          ...u,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };
        for (const coll of syncCollections) {
          await setDoc(doc(db, coll, u.uid), payload);
        }
      }
      console.log('[Seeding] Checked and seeded 3 default user mappings.');
    } else {
      console.log(`[Seeding] Custom database already contains ${snapshotUsers.size} users.`);
    }

    // 3. Seed some default reports - Disabled so user can maintain a clean, purged database
    console.log('[Seeding] Skipping default reports seeding to allow clean admin slate.');

    // 4. Community spots initialization - keep admin approved/activated spots intact
    console.log('[Seeding] Database initialization complete.');

  } catch (err: any) {
    console.error('[Seeding Error] failed to auto-seed database:', err.message);
  }
}

startServer();
