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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(express.json());

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

  // SERVER-SIDE SYNC API: Resident Synchronization across all central collections
  app.post('/api/sync-resident', async (req, res) => {
    try {
      const { uid, name, email } = req.body;
      if (!uid || !email) {
        return res.status(400).json({ error: 'Missing uid or email fields.' });
      }

      if (db) {
        const payload = {
          uid,
          name,
          email,
          role: 'resident',
          status: 'active',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        const collections = ['users', 'residents', 'registeredUsers', 'accounts'];
        const results = [];

        for (const collName of collections) {
          try {
            await setDoc(doc(db, collName, uid), payload);
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
      const { uid, name, email, role } = req.body;
      if (!uid || !email) {
        return res.status(400).json({ error: 'Missing uid or email fields.' });
      }

      if (db) {
        // Persist User Profile directly in Firestore
        await setDoc(doc(db, 'users', uid), {
          name: name || 'Anonymous User',
          email,
          role: role || 'resident',
          createdAt: Timestamp.now()
        });
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
      const { email } = req.body;
      res.json({ message: 'Login event tracked successfully on API endpoint.', email });
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

    // 3. Seed some default reports
    const qReports = collection(db, 'reports');
    const snapshotReports = await getDocs(qReports);
    if (snapshotReports.empty) {
      console.log('[Seeding] reports collection is empty! Seeding default incident items...');
      const seedReports = [
        {
          reporterId: "admin",
          reporterName: "SafeRoute Admin",
          location: { lat: 14.5590, lng: 120.9975 },
          description: "Stray dog pack reported near Faraday street park.",
          status: "approved",
          category: "animal",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        },
        {
          reporterId: "user_seed_001",
          reporterName: "Maria Clara",
          location: { lat: 14.5615, lng: 120.9980 },
          description: "Broken streetlight causing street to be dark near Edison corner.",
          status: "pending",
          category: "infrastructure",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        }
      ];

      const reportCollections = ['reports', 'incident_reports', 'activity_logs'];
      for (const rep of seedReports) {
        const docRef = await addDoc(collection(db, 'reports'), rep);
        for (const coll of reportCollections) {
          await setDoc(doc(db, coll, docRef.id), rep);
        }
      }
      console.log('[Seeding] Checked and seeded default reports.');
    }

  } catch (err: any) {
    console.error('[Seeding Error] failed to auto-seed database:', err.message);
  }
}

startServer();
