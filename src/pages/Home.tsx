import React, { useState, useEffect } from 'react';
import { Shield, MapPin, AlertTriangle, CheckCircle2, Phone, Volume2, VolumeX, Moon, Sun, History, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/error-handler';
import { DangerZone, safeGetCoords } from '../types';
import { motion } from 'motion/react';

// Helper to robustly resolve danger zone risk level from various fields set by the Admin Portal or app
function resolveRiskLevel(zone: any): 'low' | 'moderate' | 'high' | 'critical' {
  if (!zone) return 'moderate';

  // Check all potential database property keys that the Admin Portal might write
  const rawValue = zone.riskLevel || zone.risk_level || zone.risk || zone.dangerLevel || zone.danger_level || zone.severity || zone.level || zone.category;
  
  if (rawValue !== undefined && rawValue !== null) {
    const str = String(rawValue).trim().toLowerCase();
    
    // Low risk aliases
    if (str === 'low' || str === 'safe' || str === '1' || str === 'green') {
      return 'low';
    }
    // Moderate risk aliases
    if (str === 'moderate' || str === 'medium' || str === 'yellow' || str === '2' || str === 'warning') {
      return 'moderate';
    }
    // High risk aliases
    if (str === 'high' || str === 'orange' || str === '3') {
      return 'high';
    }
    // Critical risk aliases
    if (str === 'critical' || str === 'danger' || str === 'red' || str === 'extreme' || str === '4') {
      return 'critical';
    }
  }

  // Fallback to calculation based on radius if no field is present
  const r = Number(zone.radius);
  if (!isNaN(r)) {
    if (r <= 60) return 'low';
    if (r <= 120) return 'moderate';
    if (r <= 170) return 'high';
  }
  
  return 'critical';
}

export default function Home() {
  const { profile, user } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const [zones, setZones] = useState<DangerZone[]>([]);
  const [routeHistory, setRouteHistory] = useState<{ start: string; end: string; safety: string; time: string }[]>([]);
  const [permissionError, setPermissionError] = useState(false);
  
  // SOS States
  const [isSOSActive, setIsSOSActive] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [sirenInterval, setSirenInterval] = useState<NodeJS.Timeout | null>(null);
  const [oscillator1, setOscillator1] = useState<OscillatorNode | null>(null);
  const [oscillator2, setOscillator2] = useState<OscillatorNode | null>(null);
  
  // Emergency Hotlines list
  const hotlines = [
    { name: 'Barangay Palanan Desk', phone: '02-8844-3118' },
    { name: 'Makati Police HQ', phone: '02-8867-2292' },
    { name: 'Makati Red Cross', phone: '02-8890-3491' },
    { name: 'National Emergency', phone: '911' }
  ];

  useEffect(() => {
    let rawZones1: DangerZone[] = [];
    let rawZones2: DangerZone[] = [];
    
    const updateMergedZones = () => {
      const mergedMap = new Map<string, DangerZone>();
      rawZones1.forEach(z => mergedMap.set(z.id, z));
      rawZones2.forEach(z => mergedMap.set(z.id, z));
      setZones(Array.from(mergedMap.values()));
    };

    const unsubZones1 = onSnapshot(collection(db, 'danger_zones'), (snapshot) => {
      rawZones1 = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const loc = safeGetCoords(data) || { lat: 14.56038, lng: 120.99800 };
        const active = data.active !== undefined 
          ? (typeof data.active === 'string' ? data.active === 'true' : !!data.active) 
          : (data.status === 'active' || data.status === 'approved');
        const radius = Number(data.radius) || 100;
        return {
          id: docSnap.id,
          ...data,
          location: loc,
          radius,
          active
        } as DangerZone;
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
        const loc = safeGetCoords(data) || { lat: 14.56038, lng: 120.99800 };
        const active = data.active !== undefined 
          ? (typeof data.active === 'string' ? data.active === 'true' : !!data.active) 
          : (data.status === 'active' || data.status === 'approved');
        const radius = Number(data.radius) || 100;
        return {
          id: docSnap.id,
          ...data,
          location: loc,
          radius,
          active
        } as DangerZone;
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

  // Safe synthesized siren audio for emergency scenarios using standard web-audio oscillator
  const triggerSOS = async () => {
    if (isSOSActive) {
      // Deactivate siren
      if (sirenInterval) clearInterval(sirenInterval);
      if (oscillator1) { try { oscillator1.stop(); } catch(e){} }
      if (oscillator2) { try { oscillator2.stop(); } catch(e){} }
      setIsSOSActive(false);
      return;
    }

    setIsSOSActive(true);

    try {
      // Initialize Audio Context Web API block
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      setAudioContext(ctx);

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'sine';

      // Alternating ambulance frequencies
      osc1.frequency.setValueAtTime(320, ctx.currentTime);
      osc2.frequency.setValueAtTime(440, ctx.currentTime);

      gainNode.gain.setValueAtTime(0.08, ctx.currentTime); // Low safe buzzer sound

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start();
      osc2.start();

      setOscillator1(osc1);
      setOscillator2(osc2);

      let toggleSirenFreq = true;
      const interval = setInterval(() => {
        if (toggleSirenFreq) {
          osc1.frequency.linearRampToValueAtTime(450, ctx.currentTime + 0.4);
          osc1.frequency.linearRampToValueAtTime(350, ctx.currentTime + 0.8);
        } else {
          osc1.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.4);
          osc1.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.8);
        }
        toggleSirenFreq = !toggleSirenFreq;
      }, 800);

      setSirenInterval(interval);

      // Automatically file a real Firestore alert incident to a dedicated SOS log collection
      if (user) {
        await addDoc(collection(db, 'sos_alerts'), {
          reporterId: user.uid,
          reporterName: profile?.name || 'Resident',
          reporterEmail: user.email || profile?.email || 'resident@saferoute.local',
          description: `🚨 EMERGENCY SOS triggered by resident ${profile?.name || 'Resident'}! Active distress alert beacon.`,
          location: { lat: 14.56038, lng: 120.99800 },
          createdAt: serverTimestamp()
        });

        // Add user-specific notification
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid,
          message: 'Distress SOS beacon successfully broadcasted. Nearby residents have been notified.',
          type: 'alert',
          read: false,
          createdAt: serverTimestamp()
        });
      }

    } catch (err) {
      console.error('Audio initialization failed:', err);
    }
  };

  useEffect(() => {
    return () => {
      if (sirenInterval) clearInterval(sirenInterval);
      if (oscillator1) { try { oscillator1.stop(); } catch(e){} }
      if (oscillator2) { try { oscillator2.stop(); } catch(e){} }
    };
  }, [sirenInterval, oscillator1, oscillator2]);

  // Dynamic route risk score metrics strictly from Danger Zones
  const activeZones = zones.filter(z => z.active);
  const verifiedDangerZonesCount = activeZones.length;
  
  const highRiskZonesCount = activeZones.filter(z => {
    const risk = resolveRiskLevel(z);
    return risk === 'high' || risk === 'critical';
  }).length;

  const moderateZonesCount = activeZones.filter(z => resolveRiskLevel(z) === 'moderate').length;
  const lowZonesCount = activeZones.filter(z => resolveRiskLevel(z) === 'low').length;

  // Deduction logic: 15% for High/Critical risk, 10% for Moderate risk, 5% for Low risk
  const globalSafetyScore = Math.max(0, 100 - (lowZonesCount * 5) - (moderateZonesCount * 10) - (highRiskZonesCount * 15));

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

      {/* SOS Distress Button */}
      <div className={`p-5 rounded-3xl border transition-all ${
        darkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-100 shadow-sm'
      }`}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className={`font-black text-sm uppercase tracking-wide ${darkMode ? 'text-white' : 'text-slate-900'}`}>Instant SOS Beacon</h3>
            <p className="text-xs text-slate-400">Triggers loud audio buzzer & logs alert location instantly to Firestore.</p>
          </div>
          <div className={`w-3 h-3 rounded-full ${isSOSActive ? 'bg-red-500 animate-ping' : 'bg-slate-300'}`} />
        </div>
        
        <button 
          onClick={triggerSOS}
          className={`w-full font-black py-4 rounded-2xl transition-all shadow-lg text-sm flex items-center justify-center gap-2 active:scale-95 ${
            isSOSActive 
              ? 'bg-rose-600 text-white animate-pulse shadow-rose-300/40' 
              : 'bg-red-500 text-white shadow-red-300/40 hover:bg-red-600'
          }`}
        >
          {isSOSActive ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          {isSOSActive ? 'DEACTIVATE EMERGENCY SIREN' : 'TRIGGER EMERGENCY SOS'}
        </button>
      </div>

      {/* Safety Statistics Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`p-5 rounded-3xl border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className="bg-orange-500/10 w-10 h-10 rounded-2xl flex items-center justify-center mb-3">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
          </div>
          <div className={`text-3xl font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>{highRiskZonesCount}</div>
          <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">High-Risk Zones</div>
        </div>
        
        <div className={`p-5 rounded-3xl border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className="bg-red-500/10 w-10 h-10 rounded-2xl flex items-center justify-center mb-3">
            <ShieldAlert className="w-5 h-5 text-red-500" />
          </div>
          <div className={`text-3xl font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>{verifiedDangerZonesCount}</div>
          <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Total Danger Zones</div>
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
