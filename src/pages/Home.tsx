import React, { useState, useEffect } from 'react';
import { Shield, MapPin, AlertTriangle, CheckCircle2, Phone, Moon, Sun, History, ShieldAlert, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/error-handler';
import { DangerZone, safeGetCoords, isZoneResolved } from '../types';
import { isDemoMode as checkDemoMode } from '../config/demo';
import { motion } from 'motion/react';
import { ZONE_LABEL, ZONE_LABEL_PLURAL } from '../constants/labels';
import { isInsidePalanan } from '../lib/palananBounds';
import { 
  normalizeDangerZone, 
  isZoneActiveNow, 
  calculateHomeSafetyScore 
} from '../utils/zoneUtils';

export default function Home() {
  const { profile, user, isDemoMode: authIsDemoMode } = useAuth();
  const isDemo = authIsDemoMode ?? checkDemoMode(user, profile);
  const { darkMode, toggleDarkMode } = useTheme();
  const [zones, setZones] = useState<DangerZone[]>([]);
  const [routeHistory, setRouteHistory] = useState<{ start: string; end: string; safety: string; time: string }[]>([]);
  const [permissionError, setPermissionError] = useState(false);
  const [, setTick] = useState(0);

  // 1-minute clock tick to re-evaluate active time windows in real time
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Emergency Hotlines list (Ahon Palanan Mobile Contacts)
  const hotlines = [
    { name: 'Barangay Police (24/7)', phone: '0917-139-7288' },
    { name: 'Barangay Office (8AM-5PM)', phone: '0917-140-0986' },
    { name: 'Barangay Health Workers (8AM-5PM)', phone: '0917-140-2330' },
    { name: 'Police Community Precinct (PCP) 2', phone: '0967-074-3962' },
    { name: 'Bureau of Fire Protection (BFP)', phone: '0968-690-0785' }
  ];

  useEffect(() => {
    let rawZones1: DangerZone[] = [];
    let rawZones2: DangerZone[] = [];
    
    const updateMergedZones = () => {
      const mergedMap = new Map<string, DangerZone>();
      rawZones1.forEach(z => mergedMap.set(z.id, z));
      rawZones2.forEach(z => mergedMap.set(z.id, z));
      // Keep valid non-resolved danger zones strictly inside bounds and not needing location
      const unresolved = Array.from(mergedMap.values()).filter(
        z => z && z.active !== false && !isZoneResolved(z) && !z.needsLocation &&
             z.location && typeof z.location.lat === 'number' && typeof z.location.lng === 'number' &&
             !(z.location.lat === 0 && z.location.lng === 0) &&
             isInsidePalanan(z.location.lat, z.location.lng)
      );
      setZones(unresolved);
    };

    const unsubZones1 = onSnapshot(collection(db, 'danger_zones'), (snapshot) => {
      rawZones1 = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const loc = safeGetCoords(data);
        if (!loc) {
          return normalizeDangerZone({ ...data, id: docSnap.id, needsLocation: true, active: false, isResolved: true });
        }
        return normalizeDangerZone({ ...data, id: docSnap.id, location: loc, latitude: loc.lat, longitude: loc.lng });
      });
      updateMergedZones();
    }, (error) => {
      if (error?.code === 'permission-denied' || error?.message?.toLowerCase().includes('permission')) {
        setPermissionError(true);
      }
      handleFirestoreError(error, OperationType.GET, 'danger_zones');
    });

    const unsubZones2 = onSnapshot(collection(db, 'danger__zones'), (snapshot) => {
      rawZones2 = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const loc = safeGetCoords(data);
        if (!loc) {
          return normalizeDangerZone({ ...data, id: docSnap.id, needsLocation: true, active: false, isResolved: true });
        }
        return normalizeDangerZone({ ...data, id: docSnap.id, location: loc, latitude: loc.lat, longitude: loc.lng });
      });
      updateMergedZones();
    }, (error) => {
      if (error?.code === 'permission-denied' || error?.message?.toLowerCase().includes('permission')) {
        setPermissionError(true);
      }
      handleFirestoreError(error, OperationType.GET, 'danger__zones');
    });

    // Read route calculation history from local storage
    const savedRoutes = localStorage.getItem('safe_route_history');
    if (savedRoutes) {
      setRouteHistory(JSON.parse(savedRoutes));
    }

    return () => {
      unsubZones1();
      unsubZones2();
    };
  }, []);

  // Filter currently active zones based on time window
  const activeNowZones = zones.filter(z => isZoneActiveNow(z));
  const totalZonesCount = zones.length;
  const activeNowCount = activeNowZones.length;

  // Count-based formula with crime contribution capped at 30 points
  const globalSafetyScore = calculateHomeSafetyScore(activeNowZones);

  return (
    <div className="space-y-6 pb-20">
      
      {/* Header and Theme Select Block */}
      <div className="flex justify-between items-center px-1">
        <div>
          <h2 className="text-xs uppercase font-extrabold tracking-wider text-blue-500">Live Status</h2>
          <p className={`text-xl font-black transition-colors ${darkMode ? 'text-white' : 'text-slate-900'}`}>Palanan Safety Hub</p>
        </div>
        <button 
          onClick={toggleDarkMode}
          className={`p-3 rounded-full transition-all active:scale-95 border ${darkMode ? 'bg-slate-900 border-slate-800 text-yellow-400' : 'bg-white border-slate-200 text-blue-600 shadow-sm'}`}
        >
          {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      {/* Firestore Rules Permission Error Alert Banner */}
      {permissionError && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-amber-500/10 border border-amber-500/30 rounded-3xl p-5 text-amber-500 space-y-2 border-dashed"
        >
          <div className="flex items-center gap-2 font-black uppercase text-xs tracking-wider">
            <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse" />
            <span>External Firestore Security Rules Required</span>
          </div>
          <p className="text-xs leading-relaxed">
            SafeRoute is connected to your custom Firestore project (<code>saferouteapp-admin</code>). However, access is denied because the security rules on your GCP console are blocking read/list requests.
          </p>
          <div className="text-xs font-semibold leading-relaxed pt-1 border-t border-amber-500/10 mt-1">
            <span className="font-bold underline">To fix this instantly:</span> Copy the contents of <code>firestore.rules</code> from this applet's workspace and paste them into the <span className="font-bold">Firestore Database &rarr; Rules</span> tab in your Firebase Console!
          </div>
        </motion.div>
      )}

      {/* Welcome Card & Safety Score Indicator */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-3xl p-6 text-white shadow-xl relative overflow-hidden ${
          globalSafetyScore >= 80 ? 'bg-gradient-to-br from-blue-600 to-indigo-700 shadow-blue-200/50' :
          globalSafetyScore >= 50 ? 'bg-gradient-to-br from-orange-500 to-amber-600 shadow-orange-200/50' :
          'bg-gradient-to-br from-red-600 to-rose-700 shadow-red-200/50'
        }`}
      >
        <div className="relative z-10 space-y-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight mb-1">Hello, {profile?.name || 'Resident'}!</h1>
            <p className="text-white/80 text-xs font-semibold uppercase tracking-wider">MEMBER ID: {user?.uid.substring(0, 8) || 'GUEST'}</p>
          </div>
          
          <div className="flex items-center gap-4 bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
            <div className="bg-white/20 p-3 rounded-xl">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-extrabold opacity-70 uppercase tracking-widest leading-none mb-1">Barangay Safety Score</div>
              <div className="text-xl font-black leading-none">{globalSafetyScore}% - {globalSafetyScore >= 80 ? 'Highly Secure' : globalSafetyScore >= 50 ? 'Moderate Alert' : 'High Risk Area'}</div>
            </div>
          </div>
        </div>
        <Shield className="absolute -right-4 -bottom-4 w-36 h-36 text-white/5 rotate-12" />
      </motion.div>


      {/* Safety Statistics Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`p-5 rounded-3xl border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-3 ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
            <Clock className="w-5 h-5" />
          </div>
          <div className={`text-3xl font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>{activeNowCount}</div>
          <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Active Now ({ZONE_LABEL_PLURAL})</div>
        </div>
        
        <div className={`p-5 rounded-3xl border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-3 ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className={`text-3xl font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>{totalZonesCount}</div>
          <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Total {ZONE_LABEL_PLURAL}</div>
        </div>
      </div>

      {/* Emergency Hotlines Sheet */}
      <div className={`p-5 rounded-3xl border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
        <h3 className={`font-black text-xs uppercase tracking-widest text-slate-400 mb-4 px-1`}>Barangay Emergency Hotlines</h3>
        <div className="grid grid-cols-1 gap-2.5">
          {hotlines.map((hl) => (
            <a 
              key={hl.phone}
              href={`tel:${hl.phone}`} 
              className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all active:scale-[0.98] ${
                darkMode ? 'bg-slate-950 border-slate-800 hover:bg-slate-800' : 'bg-slate-50 border-slate-150 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="bg-blue-500/10 p-2 rounded-xl">
                  <Phone className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-left">
                  <div className={`font-black text-xs ${darkMode ? 'text-white' : 'text-slate-900'}`}>{hl.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{hl.phone}</div>
                </div>
              </div>
              <span className="text-[10px] font-black uppercase text-blue-500 px-3 py-1 bg-blue-500/15 rounded-full">Call</span>
            </a>
          ))}
        </div>
      </div>

      {/* Calculated Route History */}
      <div className={`p-5 rounded-3xl border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
        <div className="flex items-center gap-2 mb-4 px-1">
          <History className="w-4 h-4 text-slate-400" />
          <h3 className="font-extrabold text-xs uppercase tracking-widest text-slate-400">Your Route History</h3>
        </div>

        {routeHistory.length > 0 ? (
          <div className="space-y-3">
            {routeHistory.map((route, index) => (
              <div key={index} className={`p-4 rounded-2xl flex items-center justify-between text-xs border ${
                darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-100'
              }`}>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <span className="text-[10px] opacity-75 font-semibold">Start Coordinates</span>
                  </div>
                  <div className="font-mono text-[9px] text-slate-400">{route.start}</div>
                  
                  <div className="flex items-center gap-1 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    <span className="text-[10px] opacity-75 font-semibold">Destination</span>
                  </div>
                  <div className="font-mono text-[9px] text-slate-400">{route.end}</div>
                </div>
                
                <div className="text-right">
                  <span className={`px-2 py-0.5 rounded-full text-[8px] font-extrabold uppercase leading-tight ${
                    route.safety === 'danger' ? 'bg-red-100 text-red-600' :
                    route.safety === 'moderate' ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'
                  }`}>
                    {route.safety}
                  </span>
                  <div className="text-[8px] text-slate-400 mt-2 font-medium">{route.time}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-slate-400 text-xs font-semibold">
            No safety routes computed yet. Head to the Map page!
          </div>
        )}
      </div>

    </div>
  );
}
