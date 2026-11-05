var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_url = require("url");
var import_vite = require("vite");
var import_app = require("firebase/app");
var import_firestore = require("firebase/firestore");
var import_meta = {};
var __filename = (0, import_url.fileURLToPath)(import_meta.url);
var __dirname = import_path.default.dirname(__filename);
var ipRateLimitMap = /* @__PURE__ */ new Map();
function checkIpRateLimit(ip, maxRequests = 20, windowMs = 6e4) {
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
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json({ limit: "50mb" }));
  app.use(import_express.default.urlencoded({ limit: "50mb", extended: true }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
      "https://localhost",
      "http://localhost",
      "capacitor://localhost",
      "ionic://localhost"
    ];
    if (process.env.APP_URL) {
      try {
        const appUrlOrigin = new URL(process.env.APP_URL).origin;
        if (!allowedOrigins.includes(appUrlOrigin)) allowedOrigins.push(appUrlOrigin);
      } catch {
      }
    }
    if (origin) {
      if (allowedOrigins.includes(origin) || origin.endsWith(".run.app") || origin.includes("localhost") || origin.includes("127.0.0.1")) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  const configPath = import_path.default.join(process.cwd(), "firebase-applet-config.json");
  let db = null;
  try {
    if (import_fs.default.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(import_fs.default.readFileSync(configPath, "utf8"));
      const firebaseApp = (0, import_app.initializeApp)(firebaseConfig);
      db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)" ? (0, import_firestore.getFirestore)(firebaseApp, firebaseConfig.firestoreDatabaseId) : (0, import_firestore.getFirestore)(firebaseApp);
      console.log("Firebase initialized on Express backend successfully!");
      initializeDatabaseSeeding(db);
    } else {
      console.warn("Warning: firebase-applet-config.json not found. Backend running in partial mock mode.");
    }
  } catch (err) {
    console.error("Failed to initialize Firebase on backend:", err);
  }
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", firebaseConnected: !!db });
  });
  app.post("/api/directions/ors", async (req, res) => {
    const apiKey = process.env.OPENROUTESERVICE_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "OPENROUTESERVICE_KEY not configured", disabled: true });
    }
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "127.0.0.1";
    if (!checkIpRateLimit(clientIp, 20, 6e4)) {
      console.warn(`[ORS Proxy] Rate limit exceeded for IP: ${clientIp}`);
      return res.status(429).json({ error: "Rate limit exceeded: maximum 20 requests per minute." });
    }
    const { coordinates, avoidPolygons } = req.body;
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ error: "Invalid coordinates: array of exactly 2 points [origin, destination] required." });
    }
    for (const pt of coordinates) {
      if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== "number" || typeof pt[1] !== "number" || isNaN(pt[0]) || isNaN(pt[1])) {
        return res.status(400).json({ error: "Invalid coordinate values: each point must contain [longitude, latitude]." });
      }
    }
    const startLng = coordinates[0][0];
    const startLat = coordinates[0][1];
    const endLng = coordinates[1][0];
    const endLat = coordinates[1][1];
    const MIN_LAT = 14.549;
    const MAX_LAT = 14.57;
    const MIN_LNG = 120.988;
    const MAX_LNG = 121.01;
    if (startLat < MIN_LAT || startLat > MAX_LAT || startLng < MIN_LNG || startLng > MAX_LNG || endLat < MIN_LAT || endLat > MAX_LAT || endLng < MIN_LNG || endLng > MAX_LNG) {
      return res.status(400).json({ error: "Coordinates must be located within the Barangay Palanan study-area bounds." });
    }
    const directDistanceMeters = haversineDistanceMeters(startLat, startLng, endLat, endLng);
    if (directDistanceMeters > 3e3) {
      return res.status(400).json({ error: "Route distance exceeds maximum limit of 3 km." });
    }
    if (avoidPolygons !== void 0 && avoidPolygons !== null) {
      if (!Array.isArray(avoidPolygons)) {
        return res.status(400).json({ error: "avoidPolygons must be an array." });
      }
      if (avoidPolygons.length > 10) {
        return res.status(400).json({ error: "Maximum of 10 avoid polygons permitted." });
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
          if (!Array.isArray(vertex) || vertex.length !== 2 || typeof vertex[0] !== "number" || typeof vertex[1] !== "number") {
            return res.status(400).json({ error: `Invalid vertex coordinate in polygon at index ${pIdx}.` });
          }
        }
      }
    }
    const body = {
      coordinates
    };
    if (avoidPolygons && Array.isArray(avoidPolygons) && avoidPolygons.length > 0) {
      body.options = {
        avoid_polygons: {
          type: "MultiPolygon",
          coordinates: avoidPolygons
        }
      };
    }
    const startTime = Date.now();
    console.log(`[ORS Proxy] Live call initiating for IP ${clientIp} (coords: [${startLat.toFixed(5)}, ${startLng.toFixed(5)}] -> [${endLat.toFixed(5)}, ${endLng.toFixed(5)}], avoidPolygons: ${avoidPolygons?.length || 0})`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8e3);
      const orsResponse = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
        method: "POST",
        headers: {
          "Authorization": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const elapsed = Date.now() - startTime;
      const polygonSummary = avoidPolygons && Array.isArray(avoidPolygons) ? `${avoidPolygons.length} polygons (${avoidPolygons.map((p) => p[0]?.length || 0).join(", ")} vertices)` : "0 polygons";
      if (!orsResponse.ok) {
        const errText = await orsResponse.text();
        let parsedError = null;
        try {
          parsedError = JSON.parse(errText);
        } catch {
        }
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
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.warn(`[ORS Proxy] Request failed in ${elapsed}ms:`, err.message || "Unknown network error");
      return res.status(500).json({ error: err.message || "ORS request failed" });
    }
  });
  app.post("/api/sync-resident", async (req, res) => {
    try {
      const { uid, name, email, phoneNumber, phone, mobileNumber, authMethod, authProvider } = req.body;
      const cleanPhone = (phoneNumber || phone || mobileNumber || "").trim();
      const isPhone = authMethod === "phone" || authProvider === "phone" || !!cleanPhone || email && (email.includes("@phone.") || email.endsWith(".saferoute.ph"));
      const resolvedAuthMethod = authMethod || (isPhone ? "phone" : email ? "email" : "phone");
      const cleanEmail = email || (cleanPhone ? `${cleanPhone.replace(/[^0-9]/g, "")}@phone.saferoute.ph` : "");
      if (!uid) {
        return res.status(400).json({ error: "Missing uid field." });
      }
      if (db) {
        const payload = {
          uid,
          name: name || (cleanPhone ? `Resident (${cleanPhone})` : "Anonymous Resident"),
          email: cleanEmail,
          role: "resident",
          status: "active",
          authMethod: resolvedAuthMethod,
          authProvider: resolvedAuthMethod,
          provider: resolvedAuthMethod,
          authType: resolvedAuthMethod,
          isPhoneAuth: resolvedAuthMethod === "phone",
          createdAt: import_firestore.Timestamp.now(),
          updatedAt: import_firestore.Timestamp.now()
        };
        if (isPhone) {
          payload.phoneBridgeEmail = cleanEmail;
        }
        if (cleanPhone) {
          payload.phoneNumber = cleanPhone;
          payload.phone = cleanPhone;
          payload.mobileNumber = cleanPhone;
        }
        const collections = ["users", "residents", "registeredUsers", "accounts"];
        const results = [];
        for (const collName of collections) {
          try {
            await (0, import_firestore.setDoc)((0, import_firestore.doc)(db, collName, uid), payload, { merge: true });
            results.push({ collection: collName, status: "synced" });
          } catch (e) {
            console.error(`Backend sync failed for ${collName}/${uid}:`, e.message);
            results.push({ collection: collName, status: "failed", error: e.message });
          }
        }
        return res.json({ success: true, uid, results });
      } else {
        return res.json({ success: true, message: "Mock Sync Successfully", uid });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/sync-report", async (req, res) => {
    try {
      const { reportId, payload } = req.body;
      if (!reportId || !payload) {
        return res.status(400).json({ error: "Missing reportId or payload fields." });
      }
      if (db) {
        const enrichedPayload = {
          ...payload,
          createdAt: import_firestore.Timestamp.now(),
          updatedAt: import_firestore.Timestamp.now()
        };
        const collections = ["reports", "incident_reports", "activity_logs"];
        const results = [];
        for (const collName of collections) {
          try {
            await (0, import_firestore.setDoc)((0, import_firestore.doc)(db, collName, reportId), enrichedPayload);
            results.push({ collection: collName, status: "synced" });
          } catch (e) {
            console.error(`Backend sync failed for report ${collName}/${reportId}:`, e.message);
            results.push({ collection: collName, status: "failed", error: e.message });
          }
        }
        return res.json({ success: true, reportId, results });
      } else {
        return res.json({ success: true, message: "Mock Sync Successfully", reportId });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/register", async (req, res) => {
    try {
      const { uid, name, email, phoneNumber, phone, role, authMethod } = req.body;
      if (!uid) {
        return res.status(400).json({ error: "Missing uid field." });
      }
      const cleanPhone = (phoneNumber || phone || "").trim();
      const isPhone = authMethod === "phone" || !!cleanPhone || email && (email.includes("@phone.") || email.endsWith(".saferoute.ph"));
      const resolvedAuthMethod = authMethod || (isPhone ? "phone" : email ? "email" : "phone");
      const cleanEmail = email || (cleanPhone ? `${cleanPhone.replace(/[^0-9]/g, "")}@phone.saferoute.ph` : "");
      if (db) {
        const userDocData = {
          name: name || (cleanPhone ? `Resident (${cleanPhone})` : "Anonymous User"),
          email: cleanEmail,
          role: role || "resident",
          authMethod: resolvedAuthMethod,
          authProvider: resolvedAuthMethod,
          provider: resolvedAuthMethod,
          authType: resolvedAuthMethod,
          isPhoneAuth: resolvedAuthMethod === "phone",
          createdAt: import_firestore.Timestamp.now()
        };
        if (isPhone) {
          userDocData.phoneBridgeEmail = cleanEmail;
        }
        if (cleanPhone) {
          userDocData.phoneNumber = cleanPhone;
          userDocData.phone = cleanPhone;
          userDocData.mobileNumber = cleanPhone;
        }
        await (0, import_firestore.setDoc)((0, import_firestore.doc)(db, "users", uid), userDocData, { merge: true });
        return res.json({ message: "User registered successfully inside Firestore.", uid });
      } else {
        return res.json({ message: "User registered (Mock Mode)", uid });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/login", async (req, res) => {
    try {
      const { email, phoneNumber } = req.body;
      res.json({ message: "Login event tracked successfully on API endpoint.", email, phoneNumber });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/lookup-resident", async (req, res) => {
    try {
      const { identifier } = req.body;
      if (!identifier) {
        return res.status(400).json({ error: "Missing identifier parameter" });
      }
      if (db) {
        const cleanIdent = identifier.trim();
        const cleanDigits = cleanIdent.replace(/[^0-9]/g, "");
        const colls = ["users", "residents"];
        for (const coll of colls) {
          const snap = await (0, import_firestore.getDocs)((0, import_firestore.collection)(db, coll));
          for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const docEmail = (data.email || "").toLowerCase();
            const docPhone = (data.phoneNumber || data.phone || data.mobileNumber || "").replace(/[^0-9]/g, "");
            if (docEmail && docEmail === cleanIdent.toLowerCase() || cleanDigits.length >= 7 && docPhone && docPhone.includes(cleanDigits) || cleanDigits.length >= 7 && docEmail && docEmail.includes(cleanDigits)) {
              return res.json({
                found: true,
                uid: docSnap.id,
                name: data.name || "Resident",
                email: data.email || `${cleanDigits}@phone.saferoute.ph`,
                phoneNumber: data.phoneNumber || data.phone || cleanIdent,
                role: data.role || "resident",
                createdAt: data.createdAt
              });
            }
          }
        }
      }
      return res.json({ found: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/delete-account", async (req, res) => {
    try {
      const { uid, email } = req.body;
      if (!uid && !email) {
        return res.status(400).json({ error: "Missing uid or email for account deletion." });
      }
      if (db) {
        const collections = ["users", "residents", "registeredUsers", "accounts"];
        const deletionResults = [];
        for (const collName of collections) {
          try {
            if (uid) {
              await (0, import_firestore.deleteDoc)((0, import_firestore.doc)(db, collName, uid));
              deletionResults.push({ collection: collName, status: "deleted" });
            }
          } catch (e) {
            deletionResults.push({ collection: collName, status: "failed", error: e.message });
          }
        }
        return res.json({ success: true, message: "User account records removed from database.", results: deletionResults });
      } else {
        return res.json({ success: true, message: "User account removed (Sandbox Mode)" });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/user-privacy", async (req, res) => {
    try {
      const { uid, privacySettings } = req.body;
      if (!uid) {
        return res.status(400).json({ error: "Missing uid." });
      }
      if (db) {
        await (0, import_firestore.updateDoc)((0, import_firestore.doc)(db, "users", uid), {
          privacySettings,
          updatedAt: import_firestore.Timestamp.now()
        }).catch(async () => {
          await (0, import_firestore.setDoc)((0, import_firestore.doc)(db, "users", uid), {
            privacySettings,
            updatedAt: import_firestore.Timestamp.now()
          }, { merge: true });
        });
        return res.json({ success: true, message: "Privacy settings saved to cloud." });
      } else {
        return res.json({ success: true, message: "Privacy settings saved (Sandbox Mode)" });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/dangerzones", async (req, res) => {
    try {
      if (db) {
        const q = (0, import_firestore.collection)(db, "danger_zones");
        const snapshot = await (0, import_firestore.getDocs)(q);
        const zones = snapshot.docs.map((doc2) => ({ id: doc2.id, ...doc2.data() }));
        res.json(zones);
      } else {
        res.json([]);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/dangerzones", async (req, res) => {
    try {
      const { location, latitude, longitude, lat, lng, radius, description, addedBy, active } = req.body;
      let finalLocation = null;
      let finalLat = null;
      let finalLng = null;
      if (location && typeof location === "object") {
        const lLat = location.lat !== void 0 ? Number(location.lat) : Number(location.latitude);
        const lLng = location.lng !== void 0 ? Number(location.lng) : Number(location.longitude);
        if (!isNaN(lLat) && !isNaN(lLng)) {
          finalLocation = { lat: lLat, lng: lLng };
          finalLat = lLat;
          finalLng = lLng;
        }
      }
      if (!finalLocation) {
        const reqLat = latitude !== void 0 ? latitude : lat;
        const reqLng = longitude !== void 0 ? longitude : lng;
        if (reqLat !== void 0 && reqLng !== void 0) {
          const pLat = Number(reqLat);
          const pLng = Number(reqLng);
          if (!isNaN(pLat) && !isNaN(pLng)) {
            finalLocation = { lat: pLat, lng: pLng };
            finalLat = pLat;
            finalLng = pLng;
          }
        }
      }
      if (!finalLocation || radius === void 0 || isNaN(Number(radius))) {
        return res.status(400).json({ error: "Missing core location (lat/lng or coordinates) or radius fields" });
      }
      if (db) {
        const docRef = await (0, import_firestore.addDoc)((0, import_firestore.collection)(db, "danger_zones"), {
          location: finalLocation,
          latitude: finalLat,
          longitude: finalLng,
          radius: Number(radius),
          description: description || "No description provided.",
          addedBy: addedBy || "system",
          createdAt: import_firestore.Timestamp.now(),
          active: active !== void 0 ? typeof active === "string" ? active === "true" : !!active : true
        });
        res.json({ id: docRef.id, message: "Danger zone logged successfully." });
      } else {
        res.json({ id: "mock-zone-id", message: "Danger zone logged in Mock mode." });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.put("/api/dangerzones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const dataToUpdate = req.body;
      if (db) {
        await (0, import_firestore.updateDoc)((0, import_firestore.doc)(db, "danger_zones", id), dataToUpdate);
        res.json({ message: `Danger zone ${id} updated successfully.` });
      } else {
        res.json({ message: `Danger zone ${id} updated (Mock Mode).` });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.delete("/api/dangerzones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (db) {
        await (0, import_firestore.deleteDoc)((0, import_firestore.doc)(db, "danger_zones", id));
        res.json({ message: `Danger zone ${id} deleted successfully.` });
      } else {
        res.json({ message: `Danger zone ${id} deleted (Mock Mode).` });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/communityspots", async (req, res) => {
    try {
      if (db) {
        const q = (0, import_firestore.collection)(db, "community_spots");
        const snapshot = await (0, import_firestore.getDocs)(q);
        const spots = snapshot.docs.map((doc2) => ({ id: doc2.id, ...doc2.data() }));
        res.json(spots);
      } else {
        res.json([]);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/communityspots", async (req, res) => {
    try {
      const { title, category, location, description, reporterId, reporterName } = req.body;
      if (!title || !location || !category) {
        return res.status(400).json({ error: "Missing title, category, or location." });
      }
      if (db) {
        const payload = {
          title,
          category: category || "safe_haven",
          location: {
            lat: Number(location.lat),
            lng: Number(location.lng)
          },
          description: description || "Resident pinpointed safe community location.",
          reporterId: reporterId || "resident",
          reporterName: reporterName || "Community Member",
          upvotes: 0,
          votedUsers: [],
          active: false,
          status: "pending",
          approvedByAdmin: false,
          createdAt: import_firestore.Timestamp.now()
        };
        const docRef = await (0, import_firestore.addDoc)((0, import_firestore.collection)(db, "community_spots"), payload);
        await (0, import_firestore.setDoc)((0, import_firestore.doc)(db, "communitySpots", docRef.id), payload);
        res.json({ id: docRef.id, message: "Community spot posted successfully." });
      } else {
        res.json({ id: "mock-spot-id", message: "Community spot logged (Mock Mode)." });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/communityspots/:id/upvote", async (req, res) => {
    try {
      const { id } = req.params;
      const { userId } = req.body;
      if (db) {
        const spotRef = (0, import_firestore.doc)(db, "community_spots", id);
        const spotDoc = await (0, import_firestore.getDoc)(spotRef);
        if (spotDoc.exists()) {
          const spotData = spotDoc.data();
          const voted = spotData.votedUsers || [];
          if (!voted.includes(userId)) {
            const newVoted = [...voted, userId];
            const newUpvotes = (spotData.upvotes || 0) + 1;
            await (0, import_firestore.updateDoc)(spotRef, { upvotes: newUpvotes, votedUsers: newVoted });
            try {
              await (0, import_firestore.updateDoc)((0, import_firestore.doc)(db, "communitySpots", id), { upvotes: newUpvotes, votedUsers: newVoted });
            } catch (e) {
            }
            return res.json({ success: true, upvotes: newUpvotes });
          }
          return res.json({ success: true, upvotes: spotData.upvotes, message: "Already upvoted" });
        }
      }
      res.json({ success: true, message: "Upvoted (Mock)" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.put("/api/communityspots/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const dataToUpdate = { ...req.body };
      if (dataToUpdate.status === "approved" || dataToUpdate.status === "active" || dataToUpdate.active === true || dataToUpdate.active === "true") {
        dataToUpdate.status = "approved";
        dataToUpdate.active = true;
        dataToUpdate.approvedByAdmin = true;
      }
      if (db) {
        await (0, import_firestore.updateDoc)((0, import_firestore.doc)(db, "community_spots", id), dataToUpdate);
        try {
          await (0, import_firestore.updateDoc)((0, import_firestore.doc)(db, "communitySpots", id), dataToUpdate);
        } catch (e) {
        }
        return res.json({ success: true, message: `Community spot ${id} updated.` });
      }
      res.json({ success: true, message: "Updated (Mock)" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.delete("/api/communityspots/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (db) {
        await (0, import_firestore.deleteDoc)((0, import_firestore.doc)(db, "community_spots", id));
        try {
          await (0, import_firestore.deleteDoc)((0, import_firestore.doc)(db, "communitySpots", id));
        } catch (e) {
        }
        return res.json({ success: true, message: `Community spot ${id} deleted.` });
      }
      res.json({ success: true, message: "Deleted (Mock)" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/reports", async (req, res) => {
    try {
      if (db) {
        const q = (0, import_firestore.collection)(db, "reports");
        const snapshot = await (0, import_firestore.getDocs)(q);
        const reports = snapshot.docs.map((doc2) => ({ id: doc2.id, ...doc2.data() }));
        res.json(reports);
      } else {
        res.json([]);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/reports", async (req, res) => {
    try {
      const { reporterId, location, description, status } = req.body;
      if (!location || !description) {
        return res.status(400).json({ error: "Missing location and description." });
      }
      if (db) {
        const docRef = await (0, import_firestore.addDoc)((0, import_firestore.collection)(db, "reports"), {
          reporterId: reporterId || "system",
          location,
          description,
          status: status || "pending",
          createdAt: import_firestore.Timestamp.now(),
          updatedAt: import_firestore.Timestamp.now()
        });
        res.json({ id: docRef.id, message: "Incident report filed successfully." });
      } else {
        res.json({ id: "mock-report-id", message: "Report logged (Mock Mode)." });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.delete("/api/reports/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (db) {
        const reportCollections = ["reports", "incident_reports", "activity_logs"];
        for (const coll of reportCollections) {
          try {
            await (0, import_firestore.deleteDoc)((0, import_firestore.doc)(db, coll, id));
          } catch (e) {
          }
        }
        res.json({ success: true, message: `Report ${id} deleted across all collections.` });
      } else {
        res.json({ success: true, message: "Report deleted (Mock Mode)." });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/purge-test-reports", async (req, res) => {
    try {
      if (db) {
        const reportCollections = ["reports", "incident_reports", "activity_logs"];
        let deletedCount = 0;
        for (const coll of reportCollections) {
          const snap = await (0, import_firestore.getDocs)((0, import_firestore.collection)(db, coll));
          for (const docSnap of snap.docs) {
            await (0, import_firestore.deleteDoc)((0, import_firestore.doc)(db, coll, docSnap.id));
            deletedCount++;
          }
        }
        res.json({ success: true, message: `Purged ${deletedCount} records across collections.` });
      } else {
        res.json({ success: true, message: "Purged (Mock Mode)." });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/notifications", async (req, res) => {
    try {
      if (db) {
        const q = (0, import_firestore.collection)(db, "notifications");
        const snapshot = await (0, import_firestore.getDocs)(q);
        const notifications = snapshot.docs.map((doc2) => ({ id: doc2.id, ...doc2.data() }));
        res.json(notifications);
      } else {
        res.json([]);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/notifications", async (req, res) => {
    try {
      const { userId, message, type } = req.body;
      if (!userId || !message) {
        return res.status(400).json({ error: "Missing userId or message details." });
      }
      if (db) {
        const docRef = await (0, import_firestore.addDoc)((0, import_firestore.collection)(db, "notifications"), {
          userId,
          message,
          type: type || "alert",
          read: false,
          createdAt: import_firestore.Timestamp.now()
        });
        res.json({ id: docRef.id, message: "Notification broadcasted successfully." });
      } else {
        res.json({ id: "mock-notif-id", message: "Notification broadcasted (Mock Mode)." });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server running on http://0.0.0.0:${PORT}`);
  });
}
async function initializeDatabaseSeeding(db) {
  try {
    console.log("[Seeding] checking if database needs seeding...");
    console.log("[Seeding] Skipping default danger zones seeding.");
    const qUsers = (0, import_firestore.collection)(db, "users");
    const snapshotUsers = await (0, import_firestore.getDocs)(qUsers);
    if (snapshotUsers.empty) {
      console.log("[Seeding] users collection is empty! Seeding default tenant/resident profiles...");
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
      const syncCollections = ["users", "residents", "registeredUsers", "accounts"];
      for (const u of seedUsers) {
        const payload = {
          ...u,
          createdAt: import_firestore.Timestamp.now(),
          updatedAt: import_firestore.Timestamp.now()
        };
        for (const coll of syncCollections) {
          await (0, import_firestore.setDoc)((0, import_firestore.doc)(db, coll, u.uid), payload);
        }
      }
      console.log("[Seeding] Checked and seeded 3 default user mappings.");
    } else {
      console.log(`[Seeding] Custom database already contains ${snapshotUsers.size} users.`);
    }
    console.log("[Seeding] Skipping default reports seeding to allow clean admin slate.");
    console.log("[Seeding] Database initialization complete.");
  } catch (err) {
    console.error("[Seeding Error] failed to auto-seed database:", err.message);
  }
}
startServer();
//# sourceMappingURL=server.cjs.map
