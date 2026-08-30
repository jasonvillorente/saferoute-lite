import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents, Polyline, useMap } from 'react-leaflet';
import { collection, query, where, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, doc, Timestamp, getDocs } from 'firebase/firestore';
import L from 'leaflet';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/error-handler';
import { useAuth } from '../context/AuthContext';
import { Report, DangerZone, SavedPlace, PlaceCategory, safeGetCoords, CommunitySpot, CommunitySpotCategory, isZoneResolved } from '../types';
import { 
  checkLocationPermission, 
  requestLocationPermission, 
  getCurrentGpsPosition, 
  watchGpsPosition, 
  GpsLocationResult 
} from '../lib/nativeLocation';

// In-memory route caching to eliminate public OSRM rate limiting & APK WebView network delays
const globalRouteCache = new Map<string, any>();

function getRouteCacheKey(start: [number, number], waypoints: [number, number][], end: [number, number]): string {
  const points = [start, ...waypoints, end];
  return points.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';');
}

async function fetchRouteJsonWithTimeout(url: string, timeoutMs = 4000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}
import { 
  AlertCircle, 
  ShieldAlert,
  Navigation, 
  Loader2, 
  X, 
  MapPin, 
  Zap,
  Play,
  Square,
  Compass,
  Timer,
  ChevronRight,
  RotateCcw,
  Truck,
  User,
  Map as MapIcon,
  Search,
  CheckCircle,
  HelpCircle,
  ChevronUp,
  ChevronDown,
  Activity,
  Shield,
  Locate,
  MapPinned,
  Plus,
  ThumbsUp,
  Sparkles,
  Heart,
  Lightbulb,
  Store,
  Coffee,
  Smile,
  Layers,
  XCircle,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LocationAccuracyModal } from '../components/LocationAccuracyModal';

// Leaflet markers shadow url
const markerShadow = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

const createCommunitySpotIcon = (category: CommunitySpotCategory, isSelected: boolean = false) => {
  let badgeColor = '#10b981'; // emerald for safe_haven
  let badgeBorder = '#047857';
  let emoji = '🛡️';

  if (category === 'well_lit') {
    badgeColor = '#f59e0b';
    badgeBorder = '#b45309';
    emoji = '💡';
  } else if (category === 'friendly_business') {
    badgeColor = '#06b6d4';
    badgeBorder = '#0e7490';
    emoji = '🏪';
  } else if (category === 'community_hub') {
    badgeColor = '#8b5cf6';
    badgeBorder = '#6d28d9';
    emoji = '☕';
  } else if (category === 'enjoyed_spot') {
    badgeColor = '#ec4899';
    badgeBorder = '#be185d';
    emoji = '🌟';
  }

  const pulseClass = isSelected ? 'scale-125 z-50 ring-4 ring-emerald-400 rounded-full' : '';

  return L.divIcon({
    html: `
      <div class="relative flex flex-col items-center group cursor-pointer ${pulseClass}">
        <div class="w-9 h-9 rounded-full flex items-center justify-center text-base shadow-xl border-2 transition-transform duration-200 group-hover:scale-110"
             style="background-color: ${badgeColor}; border-color: ${badgeBorder}; color: white;">
          ${emoji}
        </div>
        <div class="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[7px]"
             style="border-t-color: ${badgeColor}; margin-top: -1px;">
        </div>
        <div class="w-2.5 h-1 bg-black/30 rounded-full blur-[1px] mt-0.5"></div>
      </div>
    `,
    className: 'custom-community-spot-pinpoint',
    iconSize: [36, 44],
    iconAnchor: [18, 42],
    popupAnchor: [0, -38]
  });
};

const getSpotCategoryIcon = (category: CommunitySpotCategory) => {
  switch (category) {
    case 'safe_haven': return '🛡️';
    case 'well_lit': return '💡';
    case 'friendly_business': return '🏪';
    case 'community_hub': return '☕';
    case 'enjoyed_spot': return '🌟';
    default: return '📍';
  }
};

const getSpotCategoryLabel = (category: CommunitySpotCategory) => {
  switch (category) {
    case 'safe_haven': return 'Safe Haven';
    case 'well_lit': return 'Well-Lit Pathway';
    case 'friendly_business': return 'Friendly 24/7 Store';
    case 'community_hub': return 'Community Hub';
    case 'enjoyed_spot': return 'Enjoyed Spot';
    default: return 'Community Spot';
  }
};

const getSpotCategoryBg = (category: CommunitySpotCategory) => {
  switch (category) {
    case 'safe_haven': return 'bg-emerald-600';
    case 'well_lit': return 'bg-amber-500';
    case 'friendly_business': return 'bg-cyan-600';
    case 'community_hub': return 'bg-purple-600';
    case 'enjoyed_spot': return 'bg-pink-600';
    default: return 'bg-slate-700';
  }
};

const DEFAULT_COMMUNITY_SPOTS: CommunitySpot[] = [];

const startIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const endIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

// reportIcon removed as requested

const userIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Real-time live user GPS puck with pulsing radar ripple & direction beam
const createLiveGpsPuckIcon = (heading: number | null = null) => {
  const hasHeading = typeof heading === 'number' && !isNaN(heading);
  const headingTransform = hasHeading ? `transform: rotate(${heading}deg);` : '';

  return L.divIcon({
    html: `
      <div class="relative flex items-center justify-center w-10 h-10 -ml-5 -mt-5">
        ${hasHeading ? `
          <div class="absolute -top-3 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[12px] border-b-blue-500 opacity-80" style="${headingTransform} transform-origin: 50% 20px;"></div>
        ` : ''}
        <span class="absolute w-8 h-8 rounded-full bg-blue-500/30 animate-ping"></span>
        <span class="absolute w-6 h-6 rounded-full bg-blue-500/40"></span>
        <div class="relative w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-md flex items-center justify-center">
          <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
        </div>
      </div>
    `,
    className: 'live-gps-puck-icon',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

const createSavedPlaceIcon = (emoji: string) => {
  return L.divIcon({
    html: `<div class="flex items-center justify-center text-xl bg-white border-2 border-blue-500 rounded-full w-8 h-8 shadow-md transition-transform duration-200 hover:scale-110 cursor-pointer">
             ${emoji}
           </div>`,
    className: 'custom-saved-place-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const PALANAN_CENTER: [number, number] = [14.56038, 120.99800];

// Enforce strict bounds around Barangay Palanan to prevent panning outside
const PALANAN_BOUNDS: [[number, number], [number, number]] = [
  [14.5510, 120.9900], // Southwest bound (Buendia LRT / Taft corridor)
  [14.5680, 121.0080]  // Northeast bound (Zobel Roxas / Pres. Osmeña Hwy)
];

const PALANAN_PLACES = [
  { name: 'Palanan Barangay Hall', latLng: [14.55986, 120.99925] as [number, number], address: 'Dian Street, Palanan, Makati' },
  { name: 'Cash & Carry Mall', latLng: [14.55845, 121.00160] as [number, number], address: 'Filmore Street, Palanan, Makati' },
  { name: 'Faraday Park & Playground', latLng: [14.56200, 120.99845] as [number, number], address: 'Faraday Street, Palanan, Makati' },
  { name: 'Buendia LRT Station', latLng: [14.55430, 120.99450] as [number, number], address: 'Taft Ave corner Gil Puyat Ave' },
  { name: 'Dian Corner Gil Puyat St', latLng: [14.55750, 120.99950] as [number, number], address: 'Dian St corner Gil Puyat Ave' },
  { name: 'Bautista Corner Zobel Roxas', latLng: [14.56300, 120.99600] as [number, number], address: 'Bautista St corner Zobel Roxas' },
  { name: 'Filmore Street Central', latLng: [14.55830, 121.00020] as [number, number], address: 'Filmore Street, Palanan, Makati' },
  { name: 'Marconi Community Center', latLng: [14.56110, 120.99530] as [number, number], address: 'Marconi Street, Palanan, Makati' }
];

// Seed some beautiful safety focus areas with low-opacity green halos
const PALANAN_SAFE_ZONES = [
  { latLng: [14.55986, 120.99925] as [number, number], radius: 90, name: "Barangay Hall Safe Hub", desc: "CCTV surveillance & regular tanod patrols" },
  { latLng: [14.56150, 120.99670] as [number, number], radius: 75, name: "School Safety Buffer", desc: "Pedestrian helpers & school peace officers" },
  { latLng: [14.56200, 120.99845] as [number, number], radius: 85, name: "Faraday Safe Corridor", desc: "Bright nighttime lighting & neighborhood watch" }
];

type SafetyLevel = 'safe' | 'moderate' | 'danger';

interface CalculatedRoute {
  coordinates: [number, number][];
  distance: number; // meters
  duration: number; // seconds
  steps: {
    instruction: string;
    distance: number;
    name: string;
  }[];
  safety: SafetyLevel;
  safetyScore: number;
  name: string;
  totalCost: number;
  segments: {
    coordinates: [number, number][];
    color: string;
  }[];
}

// Haversine exact distance formula
function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Calculate exact shortest distance in meters from a point (pLat, pLng) to a line segment (lat1,lng1 -> lat2,lng2)
function getMinDistanceToSegmentMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  pLat: number, pLng: number
): number {
  const cosLat = Math.cos(lat1 * Math.PI / 180);
  const bx = (lng2 - lng1) * 111000 * cosLat;
  const by = (lat2 - lat1) * 111000;
  const px = (pLng - lng1) * 111000 * cosLat;
  const py = (pLat - lat1) * 111000;

  const ab2 = bx * bx + by * by;
  if (ab2 === 0) {
    return getDistanceMeters(lat1, lng1, pLat, pLng);
  }

  let t = (px * bx + py * by) / ab2;
  t = Math.max(0, Math.min(1, t));

  const cx = t * bx;
  const cy = t * by;

  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Custom map events delegate
interface MapEventsProps {
  onMapClick: (latLng: [number, number]) => void;
  onMapLongPress: (latLng: [number, number]) => void;
}
function MapEventsHandler({ onMapClick, onMapLongPress }: MapEventsProps) {
  useMapEvents({
    click(e) {
      onMapClick([e.latlng.lat, e.latlng.lng]);
    },
    contextmenu(e) {
      L.DomEvent.preventDefault(e as any);
      onMapLongPress([e.latlng.lat, e.latlng.lng]);
    }
  });
  return null;
}

// Strict map bounds and zoom enforcer
function EnforceBoundsAndSettings() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const bounds = L.latLngBounds(PALANAN_BOUNDS);
    map.setMaxBounds(bounds);
    map.setMinZoom(16);
    map.setMaxZoom(20);
    
    // Auto returning if dragged boundary limits
    const handleDrag = () => {
      map.panInsideBounds(bounds, { animate: false });
    };
    
    map.on('drag', handleDrag);
    return () => {
      map.off('drag', handleDrag);
    };
  }, [map]);
  return null;
}

// Map view controller component to guarantee viewport movement & sync Leaflet map instance
function MapViewController({ 
  liveCoords, 
  autoFollow, 
  onMapInstance,
  onUserDrag
}: { 
  liveCoords: [number, number] | null; 
  autoFollow: boolean;
  onMapInstance: (map: L.Map) => void;
  onUserDrag: () => void;
}) {
  const map = useMap();
  const hasCenteredInitially = useRef(false);

  useEffect(() => {
    if (map) {
      onMapInstance(map);
    }
  }, [map, onMapInstance]);

  useMapEvents({
    dragstart() {
      onUserDrag();
    }
  });

  useEffect(() => {
    if (liveCoords && map) {
      if (!hasCenteredInitially.current || autoFollow) {
        hasCenteredInitially.current = true;
        map.setView(liveCoords, Math.max(map.getZoom(), 16), { animate: true });
      }
    }
  }, [liveCoords, autoFollow, map]);

  return null;
}

// Map boundary centering and floating controls
function FloatingMapControls({ 
  onRecenter,
  onZoomIn,
  onZoomOut,
  autoFollow,
  hasLiveGps
}: { 
  onRecenter: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  autoFollow?: boolean;
  hasLiveGps?: boolean;
}) {
  const darkMode = false;
  return (
    <div className="absolute bottom-72 right-4 flex flex-col gap-2 z-[999]">
      {/* Current Location / Recenter */}
      <button 
        onClick={onRecenter}
        id="btn-recenter-map"
        className={`p-3 rounded-full shadow-lg border transition-all active:scale-95 flex items-center justify-center w-11 h-11 ${
          autoFollow 
            ? 'bg-blue-600 border-blue-500 text-white shadow-blue-500/30' 
            : darkMode 
              ? 'bg-slate-900 border-slate-800 text-blue-400 hover:bg-slate-800' 
              : 'bg-white border-slate-200 text-blue-600 hover:bg-slate-50'
        }`}
        title={autoFollow ? "Auto-following location (Click to center)" : "Find Me & Center Location"}
      >
        <Compass className={`w-5 h-5 ${hasLiveGps ? 'animate-pulse' : ''} ${autoFollow ? 'text-white' : (darkMode ? 'text-blue-400' : 'text-blue-600')}`} />
      </button>

      {/* Easy Zoom In/Out */}
      <div className={`rounded-full shadow-lg border p-0.5 flex flex-col items-center ${
        darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        <button 
          onClick={onZoomIn}
          id="btn-zoom-in"
          className={`w-10 h-10 flex items-center justify-center font-bold rounded-full transition-colors ${
            darkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'
          }`}
          title="Zoom In"
        >
          +
        </button>
        <div className={`w-8 border-t ${darkMode ? 'border-slate-800' : 'border-slate-100'}`} />
        <button 
          onClick={onZoomOut}
          id="btn-zoom-out"
          className={`w-10 h-10 flex items-center justify-center font-bold rounded-full transition-colors ${
            darkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'
          }`}
          title="Zoom Out"
        >
          −
        </button>
      </div>
    </div>
  );
}

// Automatically snap map zoom boundaries to display whole route path
function FocusRouteBounds({ coordinates }: { coordinates: [number, number][] | null }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates && coordinates.length > 0) {
      const bounds = L.latLngBounds(coordinates.map(c => L.latLng(c[0], c[1])));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
    }
  }, [coordinates, map]);
  return null;
}

// Recalculates Leaflet size instantly when layout, sheet height, or size transition changes
function InvalidateMapSize({ trigger }: { trigger: any }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    
    // Invalidate size immediately
    map.invalidateSize();

    // Run staggered invalidations to account for any delay in CSS layout transitions
    const timers = [
      setTimeout(() => map.invalidateSize(), 50),
      setTimeout(() => map.invalidateSize(), 150),
      setTimeout(() => map.invalidateSize(), 300),
      setTimeout(() => map.invalidateSize(), 650),
      setTimeout(() => map.invalidateSize(), 1000)
    ];

    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', handleResize);
    };
  }, [map, trigger]);
  return null;
}

// Helper to robustly resolve danger zone risk level from various fields set by the Admin Portal or app
function resolveRiskLevel(zone: any): 'low' | 'moderate' | 'high' | 'critical' {
  if (!zone) return 'moderate';

  // 1. Check all potential database property keys that the Admin Portal might write
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

  // 2. Fallback to calculation based on radius if no field is present
  const r = Number(zone.radius);
  if (!isNaN(r)) {
    if (r <= 60) return 'low';
    if (r <= 120) return 'moderate';
    if (r <= 170) return 'high';
  }
  
  return 'critical';
}

export default function MapPage() {
  const darkMode = false;
  const [zones, setZones] = useState<DangerZone[]>([]);
  const [permissionError, setPermissionError] = useState(false);
  const [showLocationAccuracyModal, setShowLocationAccuracyModal] = useState(false);
  
  // Dynamic route analytics and safety segmentation helper
  const processRouteCoordinates = (coordinates: [number, number][], distance: number) => {
    let routePenalty = 0;
    let passesCritical = false;
    let passesHigh = false;
    let passesModerate = false;
    let passesLow = false;

    let approachesCritical = false;
    let approachesHigh = false;
    let approachesModerate = false;
    let approachesLow = false;

    zones.forEach(zone => {
      if (!zone || isZoneResolved(zone) || zone.active === false || !zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return;
      
      // Find minimum exact distance from any route segment to this danger zone
      let minDist = Infinity;
      if (coordinates.length === 1) {
        minDist = getDistanceMeters(coordinates[0][0], coordinates[0][1], zone.location.lat, zone.location.lng);
      } else {
        for (let i = 0; i < coordinates.length - 1; i++) {
          const p1 = coordinates[i];
          const p2 = coordinates[i + 1];
          const d = getMinDistanceToSegmentMeters(p1[0], p1[1], p2[0], p2[1], zone.location.lat, zone.location.lng);
          if (d < minDist) {
            minDist = d;
          }
        }
      }

      // Get risk level robustly from database values
      const risk = resolveRiskLevel(zone);

      // Assign heavier penalties so safe detours are prioritized over dangerous direct routes
      if (minDist <= zone.radius) {
        if (risk === 'critical') { passesCritical = true; routePenalty += 10000; }
        else if (risk === 'high') { passesHigh = true; routePenalty += 5000; }
        else if (risk === 'moderate') { passesModerate = true; routePenalty += 2000; }
        else if (risk === 'low') { passesLow = true; routePenalty += 500; }
      } else if (minDist <= zone.radius * 1.5) {
        if (risk === 'critical') { approachesCritical = true; routePenalty += 2000; }
        else if (risk === 'high') { approachesHigh = true; routePenalty += 1000; }
        else if (risk === 'moderate') { approachesModerate = true; routePenalty += 400; }
        else if (risk === 'low') { approachesLow = true; routePenalty += 100; }
      }
    });

    const totalCost = distance + routePenalty;

    // Calculate safety level
    let safety: SafetyLevel = 'safe';
    if (passesCritical || passesHigh || approachesCritical) {
      safety = 'danger';
    } else if (passesModerate || approachesHigh || passesLow) {
      safety = 'moderate';
    }

    // Calculate safety score
    let baseSafetyScore = 98;
    if (passesCritical) baseSafetyScore -= 45;
    else if (approachesCritical) baseSafetyScore -= 20;

    if (passesHigh) baseSafetyScore -= 30;
    else if (approachesHigh) baseSafetyScore -= 12;

    if (passesModerate) baseSafetyScore -= 18;
    else if (approachesModerate) baseSafetyScore -= 6;

    if (passesLow) baseSafetyScore -= 10;
    else if (approachesLow) baseSafetyScore -= 3;

    const safetyScore = Math.max(50, Math.min(98, baseSafetyScore));

    // 2. Generate visualization segments
    const segments: { coordinates: [number, number][]; color: string; }[] = [];
    let currentSegment: { coordinates: [number, number][]; color: string; } | null = null;

    for (let i = 0; i < coordinates.length - 1; i++) {
      const p1 = coordinates[i];
      const p2 = coordinates[i+1];

      let rank = 0; // Green
      zones.forEach(zone => {
        if (!zone || isZoneResolved(zone) || zone.active === false || !zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return;
        
        const d = getMinDistanceToSegmentMeters(p1[0], p1[1], p2[0], p2[1], zone.location.lat, zone.location.lng);
        const risk = resolveRiskLevel(zone);

        if (d <= zone.radius) {
          if (risk === 'critical' || risk === 'high') rank = Math.max(rank, 2); // Orange/High risk segment
          else if (risk === 'moderate') rank = Math.max(rank, 1); // Yellow
          else rank = Math.max(rank, 0); // Green
        } else if (d <= zone.radius * 1.5) {
          if (risk === 'critical' || risk === 'high') rank = Math.max(rank, 1); // Yellow for near approach
        }
      });

      // Match exact colors: Low/Green `#10B981`, Moderate/Yellow `#F59E0B`, High/Orange `#F97316`
      const colors = ['#10B981', '#F59E0B', '#F97316'];
      const segColor = colors[rank];

      if (!currentSegment) {
        currentSegment = {
          coordinates: [p1, p2],
          color: segColor
        };
      } else if (currentSegment.color === segColor) {
        currentSegment.coordinates.push(p2);
      } else {
        segments.push(currentSegment);
        currentSegment = {
          coordinates: [p1, p2],
          color: segColor
        };
      }
    }
    if (currentSegment) {
      segments.push(currentSegment);
    }

    return {
      segments,
      totalCost,
      safety,
      safetyScore
    };
  };

  // Get danger zone rendering properties based on riskLevel and active status
  const getDangerZoneSpecs = (zone: DangerZone) => {
    const level = resolveRiskLevel(zone);

    switch (level) {
      case 'low':
        return {
          color: '#10B981',
          label: '🟢 LOW RISK ZONE',
          labelClass: 'text-emerald-600 font-bold',
          fillOpacityGlow: 0.08,
          fillOpacityPrecision: 0.20,
          weight: 1,
          dashArray: '3, 4'
        };
      case 'moderate':
        return {
          color: '#F59E0B',
          label: '⚠️ MODERATE RISK ZONE',
          labelClass: 'text-amber-500 font-bold',
          fillOpacityGlow: 0.08,
          fillOpacityPrecision: 0.22,
          weight: 1,
          dashArray: '3, 4'
        };
      case 'high':
      case 'critical':
      default:
        return {
          color: '#F97316',
          label: '🚨 HIGH RISK ZONE',
          labelClass: 'text-orange-600 font-bold',
          fillOpacityGlow: 0.12,
          fillOpacityPrecision: 0.25,
          weight: 2,
          dashArray: ''
        };
    }
  };
  
  // Navigation markers
  const [startPoint, setStartPoint] = useState<[number, number] | null>(null);
  const [endPoint, setEndPoint] = useState<[number, number] | null>(null);
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');
  const [activeInputField, setActiveInputField] = useState<'start' | 'end' | null>(null);
  
  // Suggestion visibility
  const [showStartSuggestions, setShowStartSuggestions] = useState(false);
  const [showEndSuggestions, setShowEndSuggestions] = useState(false);
  
  // Route selection config
  const [routeProfile] = useState<'foot'>('foot');
  const [routes, setRoutes] = useState<CalculatedRoute[]>([]);
  const [activeRouteIndex, setActiveRouteIndex] = useState<number>(0);
  const [routeCalculated, setRouteCalculated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Simulated navigation movement
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedIndex, setSimulatedIndex] = useState(0);
  const [currentLoc, setCurrentLoc] = useState<[number, number] | null>(null);
  const [proximityAlert, setProximityAlert] = useState<string | null>(null);
  const simulationTimer = useRef<NodeJS.Timeout | null>(null);
  
  // Real-Time Live GPS Pinpoint & Movement Tracking
  const [liveGpsCoords, setLiveGpsCoords] = useState<[number, number] | null>(null);
  const [liveGpsAccuracy, setLiveGpsAccuracy] = useState<number | null>(null);
  const [liveGpsHeading, setLiveGpsHeading] = useState<number | null>(null);
  const [liveGpsSpeed, setLiveGpsSpeed] = useState<number | null>(null);
  const [autoFollowGps, setAutoFollowGps] = useState<boolean>(false);
  const watchIdRef = useRef<number | null>(null);

  // Continuous real-time GPS tracking listener
  const hasInitiallyCentered = useRef(false);
  const userInteractedWithLocationModal = useRef(false);

  // Trigger Location Accuracy dialog action to turn on GPS
  const handleTurnOnLocationAccuracy = async () => {
    userInteractedWithLocationModal.current = true;
    setShowLocationAccuracyModal(false);
    setAutoFollowGps(true);

    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        setToastMessage("⚠️ Location permission needed to find safer routes in real-time.");
        return;
      }

      const pos = await getCurrentGpsPosition();
      const newCoords: [number, number] = [pos.latitude, pos.longitude];

      setLiveGpsCoords(newCoords);
      setLiveGpsAccuracy(pos.accuracy);
      if (typeof pos.heading === 'number' && !isNaN(pos.heading)) setLiveGpsHeading(pos.heading);
      if (typeof pos.speed === 'number' && !isNaN(pos.speed)) setLiveGpsSpeed(pos.speed);

      if (mapRef.current) {
        mapRef.current.setView(newCoords, 17, { animate: true });
      }
      if (!startPoint) {
        setStartPoint(newCoords);
      }
      if (endPoint) {
        calculateSafeDirections(newCoords, endPoint);
      }
    } catch (err) {
      console.warn("GPS lookup on turn on:", err);
    }
  };

  const handleDismissLocationAccuracy = () => {
    userInteractedWithLocationModal.current = true;
    setShowLocationAccuracyModal(false);
  };

  useEffect(() => {
    let isMounted = true;
    let cleanupWatcher: (() => void) | null = null;

    const onLocationUpdate = (pos: GpsLocationResult) => {
      if (!isMounted) return;
      setShowLocationAccuracyModal(false);
      const lat = pos.latitude;
      const lng = pos.longitude;
      const accuracy = pos.accuracy;
      const heading = pos.heading;
      const speed = pos.speed;

      const newCoords: [number, number] = [lat, lng];
      setLiveGpsCoords(newCoords);
      setLiveGpsAccuracy(accuracy);
      if (typeof heading === 'number' && !isNaN(heading)) {
        setLiveGpsHeading(heading);
      }
      if (typeof speed === 'number' && !isNaN(speed)) {
        setLiveGpsSpeed(speed);
      }

      // Automatically center map on user on first GPS signal arrival or if autoFollowGps is active
      if ((!hasInitiallyCentered.current || autoFollowGps) && mapRef.current) {
        hasInitiallyCentered.current = true;
        mapRef.current.setView(newCoords, 17, { animate: true });
      }

      // Check proximity to active danger zones in real-time
      if (!isSimulating) {
        let activeDangerMsg: string | null = null;
        zones.forEach(zone => {
          if (!zone || isZoneResolved(zone) || zone.active === false || !zone.location) return;
          const d = getDistanceMeters(lat, lng, zone.location.lat, zone.location.lng);
          if (d <= zone.radius) {
            activeDangerMsg = `PROXIMITY WARNING: Inside active threat zone: "${zone.description}".`;
          } else if (d <= zone.radius * 1.4 && !activeDangerMsg) {
            activeDangerMsg = `AWARENESS: Approaching hotspot: "${zone.description}" (${Math.round(d)}m away).`;
          }
        });
        setProximityAlert(activeDangerMsg);
      }
    };

    // Check permission status on startup
    checkLocationPermission().then((status) => {
      if (!isMounted) return;
      if (status === 'granted') {
        setShowLocationAccuracyModal(false);
        getCurrentGpsPosition().then(onLocationUpdate).catch((e) => console.warn(e));
      } else if (!userInteractedWithLocationModal.current) {
        setShowLocationAccuracyModal(true);
      }
    });

    cleanupWatcher = watchGpsPosition(
      onLocationUpdate,
      (err) => {
        console.warn("GPS tracking status:", err);
      }
    );

    return () => {
      isMounted = false;
      if (cleanupWatcher) {
        cleanupWatcher();
      }
    };
  }, [autoFollowGps, zones, isSimulating]);

  // Collapsible Bottom Sheet Expansion state
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);

  // User auth details
  const { user, isAdmin, toggleUserRole } = useAuth();
  
  // Saved Places state structures
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [loadingSavedPlaces, setLoadingSavedPlaces] = useState(true);

  // Modal / forms UI visibility states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  
  // Custom Long-press popup target coordinates
  const [longPressCoords, setLongPressCoords] = useState<[number, number] | null>(null);
  
  // Add/Edit Form State
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<PlaceCategory>('home');
  const [formCoords, setFormCoords] = useState<[number, number] | null>(null);
  const [formAddress, setFormAddress] = useState('');
  const [isPickingCoordsOnMap, setIsPickingCoordsOnMap] = useState(false);

  // Community Spots feature state
  const [communitySpots, setCommunitySpots] = useState<CommunitySpot[]>(DEFAULT_COMMUNITY_SPOTS);
  const [showCommunitySpots, setShowCommunitySpots] = useState(true);
  const [selectedSpotCategory, setSelectedSpotCategory] = useState<string>('all');
  const [selectedCommunitySpot, setSelectedCommunitySpot] = useState<CommunitySpot | null>(null);

  // Add Community Spot form modal state
  const [isAddSpotModalOpen, setIsAddSpotModalOpen] = useState(false);
  const [spotTitle, setSpotTitle] = useState('');
  const [spotCategory, setSpotCategory] = useState<CommunitySpotCategory>('safe_haven');
  const [spotDescription, setSpotDescription] = useState('');
  const [spotCoords, setSpotCoords] = useState<[number, number] | null>(null);
  const [spotAddress, setSpotAddress] = useState('');
  const [upvotingSpotId, setUpvotingSpotId] = useState<string | null>(null);
  const [isPickingSpotOnMap, setIsPickingSpotOnMap] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auto-dismiss toast after 4.5s
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Active approved spots for public map view
  const activeApprovedSpots = communitySpots.filter(s => s && s.active && s.status !== 'pending');

  // Load and subscribe to Saved Places
  useEffect(() => {
    let unsubscribe = () => {};

    if (user) {
      setLoadingSavedPlaces(true);
      const q = query(collection(db, 'saved_places'), where('userId', '==', user.uid));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const places: SavedPlace[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data.name || 'Saved Place',
            category: data.category || 'custom',
            icon: data.icon || '📍',
            location: data.location || { lat: 14.56038, lng: 120.99800 },
            useCount: data.useCount || 0,
            createdAt: data.createdAt
          } as SavedPlace;
        });
        
        const seedKey = `saferoute_seeded_${user.uid}`;
        // If empty, only auto-seed if they have never been seeded before
        if (places.length === 0) {
          if (!localStorage.getItem(seedKey)) {
            localStorage.setItem(seedKey, 'true');
            seedDefaultPlaces(user.uid);
          } else {
            setSavedPlaces([]);
            setLoadingSavedPlaces(false);
          }
        } else {
          // Guard and set seeded state to true
          localStorage.setItem(seedKey, 'true');
          // Sort by useCount desc (favorites first), then by createdAt desc
          places.sort((a, b) => b.useCount - a.useCount || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
          setSavedPlaces(places);
          setLoadingSavedPlaces(false);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'saved_places');
        setLoadingSavedPlaces(false);
      });
    } else {
      // LocalStorage fallback for guests
      const local = localStorage.getItem('saved_places_guest');
      if (local) {
        try {
          const parsed = JSON.parse(local) as SavedPlace[];
          parsed.sort((a, b) => b.useCount - a.useCount);
          setSavedPlaces(parsed);
        } catch (e) {
          console.error(e);
        }
      } else {
        // Seed default places in localStorage for guest
        const guestSeed = getSeedPlaces('guest');
        localStorage.setItem('saved_places_guest', JSON.stringify(guestSeed));
        setSavedPlaces(guestSeed);
      }
      setLoadingSavedPlaces(false);
    }

    return () => unsubscribe();
  }, [user]);

  // One-time database cleanup to remove generated default danger zones and school/hospital/office saved places
  useEffect(() => {
    const performCleanup = async () => {
      try {
        // 1. Clean up default danger zones (where addedBy === 'admin')
        const qZones = collection(db, 'danger_zones');
        const snapZones = await getDocs(qZones);
        snapZones.forEach(async (docSnap) => {
          const data = docSnap.data();
          if (data.addedBy === 'admin') {
            await deleteDoc(doc(db, 'danger_zones', docSnap.id));
          }
        });

        const qZonesDouble = collection(db, 'danger__zones');
        const snapZonesDouble = await getDocs(qZonesDouble);
        snapZonesDouble.forEach(async (docSnap) => {
          const data = docSnap.data();
          if (data.addedBy === 'admin') {
            await deleteDoc(doc(db, 'danger__zones', docSnap.id));
          }
        });

        // 2. Clean up school, office (work), hospital saved places for the logged-in user or guest
        const uid = user ? user.uid : 'guest';
        const qPlaces = query(collection(db, 'saved_places'), where('userId', '==', uid));
        const snapPlaces = await getDocs(qPlaces);
        snapPlaces.forEach(async (docSnap) => {
          const data = docSnap.data();
          const name = String(data.name || '').toLowerCase();
          const category = String(data.category || '').toLowerCase();
          if (
            category === 'school' || 
            category === 'work' || 
            category === 'hospital' ||
            name.includes('school') ||
            name.includes('office') ||
            name.includes('hospital') ||
            docSnap.id === 'seed-school' ||
            docSnap.id === 'seed-work' ||
            docSnap.id === 'seed-hospital'
          ) {
            await deleteDoc(doc(db, 'saved_places', docSnap.id));
          }
        });

        // Also clean up local guest seed places
        const local = localStorage.getItem('saved_places_guest');
        if (local) {
          try {
            const parsed = JSON.parse(local) as SavedPlace[];
            const cleaned = parsed.filter(p => {
              const name = String(p.name || '').toLowerCase();
              const cat = String(p.category || '').toLowerCase();
              return !(
                cat === 'school' ||
                cat === 'work' ||
                cat === 'hospital' ||
                name.includes('school') ||
                name.includes('office') ||
                name.includes('hospital') ||
                p.id === 'seed-school' ||
                p.id === 'seed-work' ||
                p.id === 'seed-hospital'
              );
            });
            localStorage.setItem('saved_places_guest', JSON.stringify(cleaned));
          } catch (e) {
            console.error(e);
          }
        }
      } catch (error) {
        console.error("Error running database cleanup:", error);
      }
    };

    performCleanup();
  }, [user]);

  // Seed default places helper
  const getSeedPlaces = (uid: string): SavedPlace[] => {
    return [
      {
        id: 'seed-home',
        userId: uid,
        name: 'My Home 🏠',
        category: 'home',
        icon: '🏠',
        location: { lat: 14.56200, lng: 120.99845 }, // Faraday Park area
        address: 'Faraday Street, Palanan, Makati',
        useCount: 5,
        createdAt: Timestamp.now()
      }
    ];
  };

  const seedDefaultPlaces = async (uid: string) => {
    try {
      const seeds = getSeedPlaces(uid);
      const batchPromises = seeds.map(async (seed) => {
        const { id, ...data } = seed;
        await addDoc(collection(db, 'saved_places'), data);
      });
      await Promise.all(batchPromises);
    } catch (e) {
      console.error("Error seeding default places:", e);
    }
  };

  // Ref hook to trigger custom map viewport action hooks
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    let rawZones1: DangerZone[] = [];
    let rawZones2: DangerZone[] = [];

    const updateMergedZones = () => {
      const mergedMap = new Map<string, DangerZone>();
      rawZones1.forEach(z => mergedMap.set(z.id, z));
      rawZones2.forEach(z => mergedMap.set(z.id, z));
      
      // Filter out any danger zones marked as resolved or inactive
      const combined = Array.from(mergedMap.values()).filter(
        z => z && z.location && typeof z.location.lat === 'number' && typeof z.location.lng === 'number' && !isZoneResolved(z) && z.active !== false
      );
      setZones(combined);
    };
    
    // Realtime hazard areas
    const unsubZones1 = onSnapshot(
      collection(db, 'danger_zones'), 
      (snapshot) => {
        rawZones1 = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          const loc = safeGetCoords(data);
          const isResolved = isZoneResolved(data);
          const active = !isResolved && (
            data.active !== undefined 
              ? (typeof data.active === 'string' ? data.active === 'true' : !!data.active) 
              : (data.status === 'active' || data.status === 'approved' || !data.status)
          );
          const radius = Number(data.radius) || 100;
          return {
            id: docSnap.id,
            ...data,
            location: loc,
            radius,
            active,
            resolved: isResolved
          } as DangerZone;
        });
        updateMergedZones();
      },
      (error) => {
        if (error?.code === 'permission-denied' || error?.message?.toLowerCase().includes('permission')) {
          setPermissionError(true);
        }
        handleFirestoreError(error, OperationType.GET, 'danger_zones');
      }
    );

    const unsubZones2 = onSnapshot(
      collection(db, 'danger__zones'), 
      (snapshot) => {
        rawZones2 = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          const loc = safeGetCoords(data);
          const isResolved = isZoneResolved(data);
          const active = !isResolved && (
            data.active !== undefined 
              ? (typeof data.active === 'string' ? data.active === 'true' : !!data.active) 
              : (data.status === 'active' || data.status === 'approved' || !data.status)
          );
          const radius = Number(data.radius) || 100;
          return {
            id: docSnap.id,
            ...data,
            location: loc,
            radius,
            active,
            resolved: isResolved
          } as DangerZone;
        });
        updateMergedZones();
      },
      (error) => {
        if (error?.code === 'permission-denied' || error?.message?.toLowerCase().includes('permission')) {
          setPermissionError(true);
        }
        handleFirestoreError(error, OperationType.GET, 'danger__zones');
      }
    );

    // Realtime community spots listener
    const generatedTitles = [
      'Dian St Barangay Police Outpost',
      'Edison St Bright LED Walkway',
      'Filmore 24/7 Mart & Safe Haven',
      'Marconi Park Community Square',
      'Bautista Corner Garden Spot'
    ];

    const unsubSpots = onSnapshot(
      collection(db, 'community_spots'),
      (snapshot) => {
        if (!snapshot.empty) {
          const spots: CommunitySpot[] = [];
          const seenKeys = new Set<string>();

          snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            const title = (data.title || '').trim();
            if (generatedTitles.includes(title) || docSnap.id.startsWith('spot-dian') || docSnap.id.startsWith('spot-edison') || docSnap.id.startsWith('spot-filmore') || docSnap.id.startsWith('spot-marconi') || docSnap.id.startsWith('spot-bautista')) {
              // Delete generated seed spots from Firestore
              deleteDoc(doc(db, 'community_spots', docSnap.id)).catch(() => {});
              return;
            }
            const loc = safeGetCoords(data);
            if (!loc) return;

            // Clean up duplicates by title and coordinates
            const dupKey = `${title.toLowerCase()}_${loc.lat.toFixed(5)}_${loc.lng.toFixed(5)}`;
            if (seenKeys.has(dupKey)) {
              deleteDoc(doc(db, 'community_spots', docSnap.id)).catch(() => {});
              try { deleteDoc(doc(db, 'communitySpots', docSnap.id)).catch(() => {}); } catch(e){}
              return;
            }
            seenKeys.add(dupKey);

            const isActive = data.active === true || 
                             data.active === 'true' || 
                             data.status === 'approved' || 
                             data.status === 'active' || 
                             data.approvedByAdmin === true;
            const isRejected = data.status === 'rejected';

            const active = !isRejected && isActive;
            const status = isRejected ? 'rejected' : (active ? 'approved' : 'pending');

            spots.push({
              id: docSnap.id,
              title: title || 'Community Spot',
              category: (data.category || 'safe_haven') as CommunitySpotCategory,
              location: loc,
              description: data.description || '',
              reporterId: data.reporterId || 'resident',
              reporterName: data.reporterName || 'Resident',
              upvotes: Number(data.upvotes) || 0,
              votedUsers: Array.isArray(data.votedUsers) ? data.votedUsers : [],
              createdAt: data.createdAt,
              active,
              status,
              approvedByAdmin: active
            } as CommunitySpot);
          });
          setCommunitySpots(spots);
        } else {
          setCommunitySpots([]);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'community_spots');
      }
    );

    return () => { unsubZones1(); unsubZones2(); unsubSpots(); };
  }, []);

  // Auto dismiss toast messages
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Sync human-readable street names for inputs
  useEffect(() => {
    if (startPoint && typeof startPoint[0] === 'number' && typeof startPoint[1] === 'number') {
      const match = PALANAN_PLACES.find(p => p.latLng && p.latLng[0] === startPoint[0] && p.latLng[1] === startPoint[1]);
      setStartQuery(match ? match.name : `Map Point [${startPoint[0].toFixed(4)}, ${startPoint[1].toFixed(4)}]`);
    } else {
      setStartQuery('');
    }
  }, [startPoint]);

  useEffect(() => {
    if (endPoint && typeof endPoint[0] === 'number' && typeof endPoint[1] === 'number') {
      const match = PALANAN_PLACES.find(p => p.latLng && p.latLng[0] === endPoint[0] && p.latLng[1] === endPoint[1]);
      setEndQuery(match ? match.name : `Map Point [${endPoint[0].toFixed(4)}, ${endPoint[1].toFixed(4)}]`);
    } else {
      setEndQuery('');
    }
  }, [endPoint]);

  // Audio system chime
  const playAlertBuzzer = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, ctx.currentTime);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      console.warn('Silent audio blocker precaution context:', e);
    }
  };

  // Safe Grid backup generator to avoid diagonal floating lines
  const generateBackupGridPaths = (start: [number, number], end: [number, number]): CalculatedRoute[] => {
    const lat1 = start[0];
    const lng1 = start[1];
    const lat2 = end[0];
    const lng2 = end[1];

    const coords1: [number, number][] = [];
    const segments = 15;
    for (let i = 0; i <= segments; i++) {
      coords1.push([lat1, lng1 + (lng2 - lng1) * (i / segments)]);
    }
    for (let i = 0; i <= segments; i++) {
      coords1.push([lat1 + (lat2 - lat1) * (i / segments), lng2]);
    }

    const coords2: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      coords2.push([lat1 + (lat2 - lat1) * (i / segments), lng1]);
    }
    for (let i = 0; i <= segments; i++) {
      coords2.push([lat2, lng1 + (lng2 - lng1) * (i / segments)]);
    }

    const dist1 = getDistanceMeters(lat1, lng1, lat2, lng2) * 1.25;
    const dist2 = getDistanceMeters(lat1, lng1, lat2, lng2) * 1.40;

    const route1Stats = processRouteCoordinates(coords1, dist1);
    const route2Stats = processRouteCoordinates(coords2, dist2);

    return [
      {
        coordinates: coords1,
        distance: dist1,
        duration: dist1 / 1.3,
        name: "Palanan Grid Way (Shortest Road Snap)",
        safety: route1Stats.safety,
        safetyScore: route1Stats.safetyScore,
        totalCost: route1Stats.totalCost,
        segments: route1Stats.segments,
        steps: [
          { instruction: "Walk East along Palanan Residencia avenue", distance: dist1 * 0.45, name: "Palanan St" },
          { instruction: "Turn Right near the lighted residential corners", distance: dist1 * 0.55, name: "Bautista St" },
          { instruction: "Arrived safely inside Palanan bounds.", distance: 0, name: "Destination" }
        ]
      },
      {
        coordinates: coords2,
        distance: dist2,
        duration: dist2 / 1.3,
        name: "Dian Bypass Route (Safest Detour)",
        safety: route2Stats.safety,
        safetyScore: route2Stats.safetyScore,
        totalCost: route2Stats.totalCost,
        segments: route2Stats.segments,
        steps: [
          { instruction: "Head South towards Marconi Street", distance: dist2 * 0.5, name: "Marconi St" },
          { instruction: "Take safe turn past St. Clare's medical center", distance: dist2 * 0.5, name: "Dian St" },
          { instruction: "Reached final local address location safely.", distance: 0, name: "Destination" }
        ]
      }
    ];
  };

  // Perform road snapped calculations
  const calculateSafeDirections = async (currentStart = startPoint, currentEnd = endPoint) => {
    if (!currentStart || !currentEnd) {
      setErrorMessage("Please set both a Start Location and a Destination inside Palanan.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setProximityAlert(null);
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);

    const fetchRouteWithWaypoints = async (
      start: [number, number],
      waypoints: [number, number][],
      end: [number, number],
      routeName = "🛡️ Safe Detour Route"
    ): Promise<CalculatedRoute | null> => {
      const cacheKey = getRouteCacheKey(start, waypoints, end);
      if (globalRouteCache.has(cacheKey)) {
        const cached = globalRouteCache.get(cacheKey);
        const stats = processRouteCoordinates(cached.coordinates, cached.distance);
        return {
          ...cached,
          safety: stats.safety,
          safetyScore: stats.safetyScore,
          totalCost: stats.totalCost,
          segments: stats.segments,
          name: routeName
        };
      }

      try {
        const allPoints = [start, ...waypoints, end];
        const coordsString = allPoints.map(p => `${p[1]},${p[0]}`).join(';');
        const osmDeUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordsString}?overview=full&geometries=geojson&steps=true`;
        
        let data = await fetchRouteJsonWithTimeout(osmDeUrl, 3500);
        
        if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
          const fallbackUrl = `https://router.project-osrm.org/route/v1/foot/${coordsString}?overview=full&geometries=geojson&steps=true`;
          data = await fetchRouteJsonWithTimeout(fallbackUrl, 3500);
        }
        
        if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;
        
        const route = data.routes[0];
        let coordinates: [number, number][] = route.geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]] as [number, number]);
        
        // Remove dead-end spur backtracking
        if (coordinates.length >= 3) {
          const cleaned: [number, number][] = [coordinates[0]];
          for (let i = 1; i < coordinates.length; i++) {
            const curr = coordinates[i];
            if (cleaned.length >= 2) {
              const prevPrev = cleaned[cleaned.length - 2];
              if (getDistanceMeters(curr[0], curr[1], prevPrev[0], prevPrev[1]) < 12) {
                cleaned.pop();
                continue;
              }
            }
            cleaned.push(curr);
          }
          coordinates = cleaned;
        }

        const steps = route.legs?.flatMap((leg: any) => leg.steps || [])?.map((step: any) => ({
          instruction: step.maneuver?.instruction || "Continue ahead",
          distance: step.distance || 0,
          name: step.name || "Street Path"
        })) || [];
        
        const stats = processRouteCoordinates(coordinates, route.distance);
        const result: CalculatedRoute = {
          coordinates,
          distance: route.distance,
          duration: route.duration,
          steps,
          safety: stats.safety,
          safetyScore: stats.safetyScore,
          totalCost: stats.totalCost,
          segments: stats.segments,
          name: routeName
        };

        globalRouteCache.set(cacheKey, result);
        return result;
      } catch (err) {
        console.warn("Detour waypoint calculation skipped:", err);
        return null;
      }
    };

    try {
      const directCacheKey = getRouteCacheKey(currentStart, [], currentEnd);
      let data: any = null;

      if (globalRouteCache.has(directCacheKey)) {
        const cached = globalRouteCache.get(directCacheKey);
        data = { code: 'Ok', routes: [{ geometry: { coordinates: cached.coordinates.map((c: [number, number]) => [c[1], c[0]]) }, distance: cached.distance, duration: cached.duration, legs: [{ steps: cached.steps }] }] };
      } else {
        // Prioritize the dedicated pedestrian/foot routing server from the OSM Germany community
        const osmDeUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${currentStart[1]},${currentStart[0]};${currentEnd[1]},${currentEnd[0]}?overview=full&geometries=geojson&steps=true&alternatives=true`;
        data = await fetchRouteJsonWithTimeout(osmDeUrl, 3500);

        if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
          const fallbackOsrmUrl = `https://router.project-osrm.org/route/v1/foot/${currentStart[1]},${currentStart[0]};${currentEnd[1]},${currentEnd[0]}?overview=full&geometries=geojson&steps=true&alternatives=true`;
          data = await fetchRouteJsonWithTimeout(fallbackOsrmUrl, 3500);
        }
      }

      if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error("No network road path available between selected points.");
      }

      const calculated: CalculatedRoute[] = data.routes.map((route: any) => {
        const coordinates: [number, number][] = route.geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]] as [number, number]);
        const steps = route.legs?.[0]?.steps?.map((step: any) => ({
          instruction: step.maneuver?.instruction || "Continue ahead",
          distance: step.distance || 0,
          name: step.name || "Street Path"
        })) || [];

        // Apply our centralized routing and risk analytics processor
        const stats = processRouteCoordinates(coordinates, route.distance);

        return {
          coordinates,
          distance: route.distance,
          duration: route.duration,
          steps,
          safety: stats.safety,
          safetyScore: stats.safetyScore,
          totalCost: stats.totalCost,
          segments: stats.segments,
          name: "Direct Route"
        };
      });

      // --- DYNAMIC DETOUR GENERATION LOGIC ---
      // Strictly ignore danger zones that are marked as resolved or inactive
      const activeZones = zones.filter(zone => zone && !isZoneResolved(zone) && zone.active !== false && zone.location && typeof zone.location.lat === 'number' && typeof zone.location.lng === 'number');
      const validDetours: CalculatedRoute[] = [];
      
      const intersectingZones = activeZones.filter(zone => {
        return calculated.some(route => {
          if (!route.coordinates || route.coordinates.length < 2) return false;
          for (let i = 0; i < route.coordinates.length - 1; i++) {
            const p1 = route.coordinates[i];
            const p2 = route.coordinates[i + 1];
            const d = getMinDistanceToSegmentMeters(p1[0], p1[1], p2[0], p2[1], zone.location.lat, zone.location.lng);
            if (d <= zone.radius * 1.05) return true;
          }
          return false;
        });
      });

      if (intersectingZones.length > 0) {
        const detourPromises: Promise<CalculatedRoute | null>[] = [];

        // Limit detour query volume to avoid rate limiting on mobile APK
        intersectingZones.slice(0, 2).forEach(zone => {
          const latDegreeMeters = 111000;
          const lngDegreeMeters = 111000 * Math.cos(zone.location.lat * Math.PI / 180);
          const shiftMeters = Math.max(zone.radius + 35, 75);

          const shiftLat = shiftMeters / latDegreeMeters;
          const shiftLng = shiftMeters / lngDegreeMeters;

          // Lateral Waypoints (North-East, South-West bypasses) around threat zone
          const wayNorth: [number, number] = [zone.location.lat + shiftLat, zone.location.lng];
          const waySouth: [number, number] = [zone.location.lat - shiftLat, zone.location.lng];
          const wayEast: [number, number] = [zone.location.lat, zone.location.lng + shiftLng];
          const wayWest: [number, number] = [zone.location.lat, zone.location.lng - shiftLng];

          detourPromises.push(fetchRouteWithWaypoints(currentStart, [wayNorth], currentEnd, "🛡️ Safe Detour via Calatagan St"));
          detourPromises.push(fetchRouteWithWaypoints(currentStart, [waySouth], currentEnd, "🛡️ Safe Detour (South Corridor)"));
          detourPromises.push(fetchRouteWithWaypoints(currentStart, [wayEast], currentEnd, "🛡️ Safe Detour (East Bypass)"));
          detourPromises.push(fetchRouteWithWaypoints(currentStart, [wayWest], currentEnd, "🛡️ Safe Detour (West Bypass)"));
        });

        const detourResults = await Promise.all(detourPromises);

        // STRICT FILTERING: Only accept detour routes that NEVER enter the danger zone and have superior safety
        detourResults.forEach(detour => {
          if (!detour || !detour.coordinates || detour.coordinates.length < 2) return;

          // Check if any segment crosses inside any threat circle
          let crossesInside = false;
          for (const zone of activeZones) {
            for (let i = 0; i < detour.coordinates.length - 1; i++) {
              const p1 = detour.coordinates[i];
              const p2 = detour.coordinates[i + 1];
              const d = getMinDistanceToSegmentMeters(p1[0], p1[1], p2[0], p2[1], zone.location.lat, zone.location.lng);
              if (d <= zone.radius * 0.95) {
                crossesInside = true;
                break;
              }
            }
            if (crossesInside) break;
          }

          if (crossesInside) return; // Discard routes that cut through danger zones!
          if (detour.safety === 'danger') return; // Discard dangerous detours!

          // Deduplicate
          const isDup = validDetours.some(v => Math.abs(v.distance - detour.distance) < 20 && v.safetyScore === detour.safetyScore);
          if (!isDup) {
            validDetours.push(detour);
          }
        });

        // If OSRM failed to produce an off-circle road route, construct an orthogonal safe grid detour as fallback
        if (validDetours.length === 0 && intersectingZones.length > 0) {
          intersectingZones.forEach(zone => {
            const bufferMeters = zone.radius + 35;
            const latDeg = bufferMeters / 111000;
            const lngDeg = bufferMeters / (111000 * Math.cos(zone.location.lat * Math.PI / 180));

            const northLat = zone.location.lat + latDeg;
            const southLat = zone.location.lat - latDeg;

            const gridNorth: [number, number][] = [
              currentStart,
              [northLat, currentStart[1]],
              [northLat, currentEnd[1]],
              currentEnd
            ];

            const gridSouth: [number, number][] = [
              currentStart,
              [southLat, currentStart[1]],
              [southLat, currentEnd[1]],
              currentEnd
            ];

            [gridNorth, gridSouth].forEach((gridCoords, i) => {
              const dist = getDistanceMeters(currentStart[0], currentStart[1], gridCoords[1][0], gridCoords[1][1]) +
                           getDistanceMeters(gridCoords[1][0], gridCoords[1][1], gridCoords[2][0], gridCoords[2][1]) +
                           getDistanceMeters(gridCoords[2][0], gridCoords[2][1], currentEnd[0], currentEnd[1]);

              const stats = processRouteCoordinates(gridCoords, dist);
              if (stats.safety === 'safe') {
                validDetours.push({
                  coordinates: gridCoords,
                  distance: dist,
                  duration: dist / 1.3,
                  steps: [
                    { instruction: "Walk via Calatagan Street safe corridor", distance: dist * 0.5, name: "Calatagan St" },
                    { instruction: "Turn towards destination along safe path", distance: dist * 0.5, name: "Marconi St" }
                  ],
                  safety: stats.safety,
                  safetyScore: stats.safetyScore,
                  totalCost: stats.totalCost,
                  segments: stats.segments,
                  name: `🛡️ Safe Grid Detour ${i + 1} (Calatagan St Bypass)`
                });
              }
            });
          });
        }
      }
      // --- END OF DYNAMIC DETOUR LOGIC ---

      // Separate direct route (primary OSRM route)
      const directRoute = calculated[0];
      if (directRoute) {
        if (directRoute.safety === 'safe') {
          directRoute.name = "Direct Walk (Shortest & Safe)";
        } else if (directRoute.safety === 'moderate') {
          directRoute.name = "Direct Walk (Crosses Moderate Risk Zone)";
        } else {
          directRoute.name = "Direct Walk (Crosses Active Threat Zone)";
        }
      }

      // Filter and deduplicate valid detours to keep only distinct, unique options (max 2)
      const distinctDetours: CalculatedRoute[] = [];
      validDetours.sort((a, b) => a.distance - b.distance);

      for (const detour of validDetours) {
        // Skip if distance is almost identical (< 35m difference) to an already selected detour
        const isSimilar = distinctDetours.some(d => Math.abs(d.distance - detour.distance) < 35);
        if (!isSimilar) {
          distinctDetours.push(detour);
        }
        if (distinctDetours.length >= 2) break; // Maximum 2 distinct safe detours
      }

      // Format names for distinct safe detours
      distinctDetours.forEach((detour, idx) => {
        if (idx === 0) {
          detour.name = detour.name.includes("Calatagan")
            ? "🛡️ Safe Detour via Calatagan St (RECOMMENDED)"
            : "🛡️ Safe Detour Route (RECOMMENDED)";
        } else {
          detour.name = "🛡️ Alternate Safe Detour";
        }
      });

      // Construct clean final list: [Direct Walk, Safe Detour 1, Safe Detour 2 (if distinct)]
      const finalRoutes: CalculatedRoute[] = [];
      if (directRoute) {
        finalRoutes.push(directRoute);
      }
      distinctDetours.forEach(d => finalRoutes.push(d));

      // Default active selection: Recommend the Safe Detour (Index 1) if direct route passes danger zone
      const defaultActiveIndex = (directRoute && directRoute.safety !== 'safe' && distinctDetours.length > 0) ? 1 : 0;

      setRoutes(finalRoutes);
      setActiveRouteIndex(defaultActiveIndex);
      setRouteCalculated(true);
      setIsSheetExpanded(true); // Auto expand to show metrics instantly

    } catch (err) {
      console.warn("Unable to connect to dynamic public OSRM. Snapping backup orthogonal street grid:", err);
      const fallback = generateBackupGridPaths(currentStart, currentEnd);
      
      // Sort backup grid paths as well
      fallback.sort((a, b) => a.totalCost - b.totalCost);
      
      setRoutes(fallback);
      setActiveRouteIndex(0);
      setRouteCalculated(true);
      setIsSheetExpanded(true); // Auto expand
    } finally {
      setLoading(false);
    }
  };

  // Map Tap Interaction Helper
  const handleMapSelection = (latLng: [number, number]) => {
    if (isSimulating) return;

    if (isPickingSpotOnMap) {
      setSpotCoords(latLng);
      // Try to find if there is a matching predefined landmark
      const matchedLandmark = PALANAN_PLACES.find(p => getDistanceMeters(latLng[0], latLng[1], p.latLng[0], p.latLng[1]) <= 25);
      setSpotAddress(matchedLandmark ? matchedLandmark.address : `Pinned Location [${latLng[0].toFixed(5)}, ${latLng[1].toFixed(5)}]`);
      setIsPickingSpotOnMap(false);
      // Re-open Community Spot form modal with pinpoint location applied!
      setIsAddSpotModalOpen(true);
      return;
    }

    if (isPickingCoordsOnMap) {
      setFormCoords(latLng);
      // Try to find if there is a matching predefined landmark
      const matchedLandmark = PALANAN_PLACES.find(p => getDistanceMeters(latLng[0], latLng[1], p.latLng[0], p.latLng[1]) <= 25);
      setFormAddress(matchedLandmark ? matchedLandmark.address : `Pinned on map coordinates: [${latLng[0].toFixed(5)}, ${latLng[1].toFixed(5)}]`);
      setIsPickingCoordsOnMap(false);
      // Re-open form modal with coordinates applied smoothly!
      setIsAddModalOpen(true);
      setActiveInputField(null);
      return;
    }

    if (activeInputField === 'start' || (!startPoint && activeInputField !== 'end')) {
      setStartPoint(latLng);
      setActiveInputField('end'); // Auto-advance to destination selection
    } else {
      setEndPoint(latLng);
      setActiveInputField(null);
    }
  };

  // Quick Navigation: tap saved place -> automatically generate safes route from current location
  const selectSavedPlaceCommute = async (place: SavedPlace) => {
    if (!place || !place.location || typeof place.location.lat !== 'number' || typeof place.location.lng !== 'number') {
      console.warn("Cannot commute to place without valid location coordinates.");
      return;
    }
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);
    setCurrentLoc(null);
    setProximityAlert(null);

    // Set starting point to current location (defaults to PALANAN_CENTER if empty)
    const startPointCoords = PALANAN_CENTER;
    setStartPoint(startPointCoords);
    setEndPoint([place.location.lat, place.location.lng]);

    // Track/Increment usage count in firestore / localStorage to support sorting favorites first
    try {
      if (user) {
        // Increment usage count in firestore
        const path = `saved_places/${place.id}`;
        try {
          await updateDoc(doc(db, 'saved_places', place.id), {
            useCount: place.useCount + 1
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      } else {
        const updated = savedPlaces.map(p => p.id === place.id ? { ...p, useCount: p.useCount + 1 } : p);
        localStorage.setItem('saved_places_guest', JSON.stringify(updated));
        setSavedPlaces(updated);
      }
    } catch (e) {
      console.error("Failed to increment useCount:", e);
    }

    // Give state a split second to catch up, then run automatic route generation
    setTimeout(() => {
      calculateSafeDirections(startPointCoords, [place.location.lat, place.location.lng]);
    }, 100);
  };

  // Form submit add/edit places
  const handleSavePlace = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formName.trim() || !formCoords) {
      alert("Please provide a name and location.");
      return;
    }

    const categoryIcons: Record<PlaceCategory, string> = {
      home: '🏠',
      school: '🏫',
      work: '💼',
      hospital: '🏥',
      store: '🛒',
      favorite: '⭐',
      custom: '📍'
    };

    const placeData = {
      userId: user?.uid || 'guest',
      name: formName,
      category: formCategory,
      icon: categoryIcons[formCategory],
      location: {
        lat: formCoords[0],
        lng: formCoords[1]
      },
      address: formAddress || `Palanan Coords [${formCoords[0].toFixed(5)}, ${formCoords[1].toFixed(5)}]`,
      useCount: editingPlace ? editingPlace.useCount : 0,
      createdAt: editingPlace ? editingPlace.createdAt : Timestamp.now()
    };

    try {
      if (editingPlace) {
        // Handle update
        if (user) {
          const path = `saved_places/${editingPlace.id}`;
          try {
            await updateDoc(doc(db, 'saved_places', editingPlace.id), placeData);
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, path);
          }
        } else {
          // Update local storage
          const updated = savedPlaces.map(p => p.id === editingPlace.id ? { ...p, ...placeData } : p);
          localStorage.setItem('saved_places_guest', JSON.stringify(updated));
          setSavedPlaces(updated);
        }
      } else {
        // Handle create
        if (user) {
          const path = 'saved_places';
          try {
            await addDoc(collection(db, 'saved_places'), placeData);
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, path);
          }
        } else {
          // Add local storage
          const newPlace: SavedPlace = {
            id: `local-${Date.now()}`,
            ...placeData
          } as SavedPlace;
          const updated = [newPlace, ...savedPlaces];
          localStorage.setItem('saved_places_guest', JSON.stringify(updated));
          setSavedPlaces(updated);
        }
      }

      // Close modal & reset form
      setIsAddModalOpen(false);
      setEditingPlace(null);
      resetForm();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeletePlace = async (placeId: string) => {
    try {
      if (user) {
        const path = `saved_places/${placeId}`;
        try {
          await deleteDoc(doc(db, 'saved_places', placeId));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      } else {
        const updated = savedPlaces.filter(p => p.id !== placeId);
        localStorage.setItem('saved_places_guest', JSON.stringify(updated));
        setSavedPlaces(updated);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Community Spot actions
  const handleUpvoteSpot = async (spotId: string) => {
    if (upvotingSpotId) return;
    setUpvotingSpotId(spotId);

    try {
      const userId = user ? user.uid : `guest_${Date.now()}`;
      
      // Optimistic update
      setCommunitySpots(prev => prev.map(s => {
        if (s.id === spotId) {
          const voted = s.votedUsers || [];
          if (!voted.includes(userId)) {
            return {
              ...s,
              upvotes: (s.upvotes || 0) + 1,
              votedUsers: [...voted, userId]
            };
          }
        }
        return s;
      }));

      if (db) {
        try {
          const current = communitySpots.find(s => s.id === spotId);
          if (current) {
            const voted = current.votedUsers || [];
            if (!voted.includes(userId)) {
              const spotRef = doc(db, 'community_spots', spotId);
              await updateDoc(spotRef, {
                upvotes: (current.upvotes || 0) + 1,
                votedUsers: [...voted, userId]
              });
              try {
                await updateDoc(doc(db, 'communitySpots', spotId), {
                  upvotes: (current.upvotes || 0) + 1,
                  votedUsers: [...voted, userId]
                });
              } catch (e) { /* ignore */ }
            }
          }
        } catch (e) {
          console.error("Firestore spot upvote error", e);
        }
      }

      try {
        await fetch(`/api/communityspots/${spotId}/upvote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });
      } catch (e) {
        console.error("API spot upvote error", e);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpvotingSpotId(null);
    }
  };

  const selectSpotDestination = (spot: CommunitySpot) => {
    if (!spot || !spot.location) return;
    const coords: [number, number] = [spot.location.lat, spot.location.lng];
    setEndPoint(coords);
    setEndQuery(spot.title);
    if (!startPoint) {
      setStartPoint(PALANAN_CENTER);
    }
    setIsSheetExpanded(true);
    calculateSafeDirections(startPoint || PALANAN_CENTER, coords);
  };

  const handleCreateCommunitySpot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spotTitle.trim() || !spotCoords) return;

    try {
      const payload = {
        title: spotTitle.trim(),
        category: spotCategory,
        location: { lat: spotCoords[0], lng: spotCoords[1] },
        description: spotDescription.trim() || 'Resident suggested community spot.',
        reporterId: user ? user.uid : 'resident',
        reporterName: user ? (user.displayName || user.email?.split('@')[0] || 'Resident') : 'Resident',
        upvotes: 0,
        votedUsers: [],
        status: 'pending' as const,
        active: false,
        createdAt: Timestamp.now()
      };

      let createdDocId: string | null = null;
      if (db) {
        try {
          const docRef = await addDoc(collection(db, 'community_spots'), payload);
          createdDocId = docRef.id;
          try {
            await setDoc(doc(db, 'communitySpots', docRef.id), payload);
          } catch (e) {}
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'community_spots');
        }
      }

      if (!createdDocId) {
        try {
          const res = await fetch('/api/communityspots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          createdDocId = data?.id || null;
        } catch (err) {
          console.error(err);
        }
      }

      if (!db && createdDocId) {
        const newSpot: CommunitySpot = {
          id: createdDocId || `spot-local-${Date.now()}`,
          ...payload
        };
        setCommunitySpots(prev => {
          if (prev.some(s => s.id === newSpot.id || s.title.toLowerCase() === newSpot.title.toLowerCase())) return prev;
          return [newSpot, ...prev];
        });
      }

      setIsAddSpotModalOpen(false);
      setSpotTitle('');
      setSpotCategory('safe_haven');
      setSpotDescription('');
      setSpotCoords(null);
      setSpotAddress('');

      setToastMessage(`📩 Suggestion Sent!\nYour community spot suggestion '${spotTitle}' has been submitted for review. It will appear on the public map once approved by Barangay Palanan.`);
    } catch (err) {
      console.error(err);
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormCategory('home');
    setFormCoords(null);
    setFormAddress('');
    setIsPickingCoordsOnMap(false);
  };

  // Floating button GPS locator and center trigger
  const handleLocateAndCenter = async () => {
    setAutoFollowGps(true);
    setToastMessage("🛰️ Detecting your live GPS location...");

    try {
      const status = await checkLocationPermission();
      if (status !== 'granted') {
        const granted = await requestLocationPermission();
        if (!granted) {
          setShowLocationAccuracyModal(true);
          return;
        }
      }

      const pos = await getCurrentGpsPosition();
      const gpsCoords: [number, number] = [pos.latitude, pos.longitude];

      setLiveGpsCoords(gpsCoords);
      setLiveGpsAccuracy(pos.accuracy);
      if (typeof pos.heading === 'number' && !isNaN(pos.heading)) setLiveGpsHeading(pos.heading);
      if (typeof pos.speed === 'number' && !isNaN(pos.speed)) setLiveGpsSpeed(pos.speed);

      if (mapRef.current) {
        mapRef.current.setView(gpsCoords, 17, { animate: true });
      }
      if (!startPoint) {
        setStartPoint(gpsCoords);
      }
      if (endPoint) {
        calculateSafeDirections(gpsCoords, endPoint);
      }

      setToastMessage(`📍 GPS Located! Precision: ±${Math.round(pos.accuracy)}m`);
    } catch (err) {
      console.warn("GPS lookup error:", err);
      setShowLocationAccuracyModal(true);
    }
  };

  // Zoom controls wrappers
  const handleZoomIn = () => {
    if (mapRef.current) {
      mapRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      mapRef.current.zoomOut();
    }
  };

  // Simulating active GPS path
  const startSimulation = () => {
    if (!routes[activeRouteIndex]) return;
    setIsSimulating(true);
    setSimulatedIndex(0);
    const coords = routes[activeRouteIndex].coordinates;
    setCurrentLoc(coords[0]);
    setProximityAlert(null);

    if (simulationTimer.current) clearInterval(simulationTimer.current);

    simulationTimer.current = setInterval(() => {
      setSimulatedIndex(prev => {
        const nextIdx = prev + 3; // Step faster to bypass long wait
        if (nextIdx >= coords.length) {
          clearInterval(simulationTimer.current!);
          setIsSimulating(false);
          playAlertBuzzer();
          setCurrentLoc(coords[coords.length - 1]);
          return coords.length - 1;
        }

        const point = coords[nextIdx];
        setCurrentLoc(point);

        // Scan radar alert proximity limits
        let activeDangerMsg: string | null = null;
        zones.forEach(zone => {
          if (!zone || isZoneResolved(zone) || zone.active === false || !zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return;
          const d = getDistanceMeters(point[0], point[1], zone.location.lat, zone.location.lng);
          if (d <= zone.radius) {
            activeDangerMsg = `PROXIMITY WARNING: Inside active threat zone: "${zone.description}".`;
          } else if (d <= zone.radius * 1.5 && !activeDangerMsg) {
            activeDangerMsg = `AWARENESS: Nearing crime hotspot: "${zone.description}" within ${Math.round(d)}m.`;
          }
        });

        if (activeDangerMsg) {
          setProximityAlert(activeDangerMsg);
          playAlertBuzzer();
        } else {
          setProximityAlert(null);
        }

        return nextIdx;
      });
    }, 800);
  };

  const stopSimulation = () => {
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);
    setCurrentLoc(null);
    setProximityAlert(null);
  };

  const triggerDetour = () => {
    if (!currentLoc) return;
    // Off-route displacement
    const offroadPoint: [number, number] = [
      currentLoc[0] + 0.0012,
      currentLoc[1] - 0.0012
    ];
    setStartPoint(offroadPoint);
    setCurrentLoc(offroadPoint);
    setProximityAlert("GPS REROUTING: Off-course path detected. Re-evaluating safe streets...");
    playAlertBuzzer();

    setTimeout(() => {
      calculateSafeDirections(offroadPoint, endPoint);
    }, 1500);
  };

  const resetMapForm = () => {
    setStartPoint(null);
    setEndPoint(null);
    setStartQuery('');
    setEndQuery('');
    setRouteCalculated(false);
    setRoutes([]);
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);
    setCurrentLoc(null);
    setProximityAlert(null);
    setIsSheetExpanded(false);
  };

  const handleClearStartPoint = () => {
    setStartPoint(null);
    setStartQuery('');
    setRouteCalculated(false);
    setRoutes([]);
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);
    setCurrentLoc(null);
    setProximityAlert(null);
  };

  const handleClearEndPoint = () => {
    setEndPoint(null);
    setEndQuery('');
    setRouteCalculated(false);
    setRoutes([]);
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);
    setCurrentLoc(null);
    setProximityAlert(null);
  };

  // Computed variables for selected metrics display
  const activeRoute = routes[activeRouteIndex] || null;
  const activeDistanceString = activeRoute ? `${(activeRoute.distance / 1000).toFixed(1)} km` : "1.3 km";
  const activeTimeString = activeRoute ? `${Math.max(1, Math.ceil(activeRoute.duration / 60))} minutes` : "15 minutes";
  const activeScore = activeRoute ? activeRoute.safetyScore : 92;

  // Filter recommendations matching address
  const startPlacesFiltered = PALANAN_PLACES.filter(p => p.name.toLowerCase().includes(startQuery.toLowerCase()));
  const endPlacesFiltered = PALANAN_PLACES.filter(p => p.name.toLowerCase().includes(endQuery.toLowerCase()));

  return (
    <div id="palanan-map-page-wrapper" className={`absolute inset-0 z-0 overflow-hidden flex flex-col -mx-4 -mt-4 ${darkMode ? 'bg-slate-950' : 'bg-slate-100'}`}>
      
      {/* 1. Main Background Map Frame - occupies 80-90% height */}
      <div id="full-screen-map-container" className="relative flex-1 w-full h-full z-0">
        <MapContainer 
          center={PALANAN_CENTER} 
          zoom={17} 
          ref={mapRef}
          className="w-full h-full z-0" 
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url={darkMode 
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" 
              : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
          />
          <MapEventsHandler onMapClick={handleMapSelection} onMapLongPress={setLongPressCoords} />
          
          {/* Custom Saved Places markers visible on map */}
          {savedPlaces.filter(pl => pl && pl.location && typeof pl.location.lat === 'number' && typeof pl.location.lng === 'number').map((pl) => (
            <Marker 
              key={`marker-${pl.id}`} 
              position={[pl.location.lat, pl.location.lng]} 
              icon={createSavedPlaceIcon(pl.icon)}
            >
              <Popup>
                <div className="p-1 px-1.5 text-xs text-slate-800 space-y-1">
                  <div className="flex items-center gap-1 font-bold text-slate-850">
                    <span>{pl.icon}</span>
                    <span>{pl.name}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">{pl.address || 'Saved Place Location'}</p>
                  <button 
                    onClick={() => selectSavedPlaceCommute(pl)}
                    className="mt-1.5 w-full bg-blue-600 text-white rounded py-1 px-2 text-[10px] font-bold text-center flex items-center justify-center gap-1 tracking-wide shadow-sm hover:bg-blue-700 transition"
                  >
                    Set Destination
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Long Press coordinate pinning popup */}
          {longPressCoords && (
            <Popup 
              position={longPressCoords}
              onClose={() => setLongPressCoords(null)}
            >
              <div className="p-2.5 space-y-2 text-center text-xs min-w-[150px]">
                <p className="font-bold text-slate-800">Save this location?</p>
                <p className="text-[10px] text-slate-500 font-mono">
                  [{longPressCoords[0].toFixed(5)}, {longPressCoords[1].toFixed(5)}]
                </p>
                <div className="flex gap-2 justify-center pt-1">
                  <button
                    onClick={() => {
                      const coords = longPressCoords;
                      setLongPressCoords(null);
                      setEditingPlace(null);
                      resetForm();
                      setFormCoords(coords);
                      setFormName('');
                      setFormCategory('custom');
                      setIsAddModalOpen(true);
                    }}
                    className="px-2.5 py-1 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 active:scale-95 transition-all text-[11px]"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setLongPressCoords(null)}
                    className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 active:scale-95 transition-all text-[11px]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Popup>
          )}

          <EnforceBoundsAndSettings />
          <MapViewController 
            liveCoords={liveGpsCoords} 
            autoFollow={autoFollowGps} 
            onMapInstance={(m) => { mapRef.current = m; }} 
            onUserDrag={() => setAutoFollowGps(false)} 
          />
          <InvalidateMapSize trigger={`${isSheetExpanded}-${routeCalculated}-${isSimulating}`} />

          {/* Boundaries zoom auto fit */}
          {routeCalculated && activeRoute && (
            <FocusRouteBounds coordinates={activeRoute.coordinates} />
          )}

          {/* Green halos of Predefined Safe Corridors in Palanan - Removed as requested */}


          {/* Crime Danger zones heatmaps / halos */}
          {zones.filter(zone => zone && !isZoneResolved(zone) && zone.active !== false && zone.location && typeof zone.location.lat === 'number' && typeof zone.location.lng === 'number').map((zone) => {
            const specs = getDangerZoneSpecs(zone);
            return (
              <React.Fragment key={zone.id}>
                {/* Translucent heatmap glow */}
                <Circle 
                  center={[zone.location.lat, zone.location.lng]} 
                  radius={zone.radius * 1.5} 
                  pathOptions={{ 
                    fillColor: specs.color, 
                    fillOpacity: specs.fillOpacityGlow, 
                    color: 'transparent',
                    weight: 0
                  }} 
                />
                {/* Precision threshold boundary */}
                <Circle 
                  center={[zone.location.lat, zone.location.lng]} 
                  radius={zone.radius} 
                  pathOptions={{ 
                    fillColor: specs.color, 
                    fillOpacity: specs.fillOpacityPrecision, 
                    color: specs.color, 
                    weight: specs.weight,
                    dashArray: specs.dashArray
                  }} 
                >
                  <Popup>
                    <div id={`danger-zone-popup-${zone.id}`} className="text-xs p-1">
                      <span className={`font-bold uppercase tracking-wide block ${specs.labelClass}`}>
                        {specs.label}
                      </span>
                      <p className="mt-1 font-semibold text-slate-850">{zone.description}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">Active monitoring within {zone.radius}m</p>
                    </div>
                  </Popup>
                </Circle>
              </React.Fragment>
            );
          })}

          {/* Community Spots Pinpoint Markers */}
          {showCommunitySpots && communitySpots
            .filter(spot => spot && spot.active && spot.status === 'approved' && spot.location && typeof spot.location.lat === 'number' && typeof spot.location.lng === 'number')
            .filter(spot => selectedSpotCategory === 'all' || spot.category === selectedSpotCategory)
            .map((spot) => {
              const isSelected = selectedCommunitySpot?.id === spot.id;
              return (
                <Marker
                  key={`spot-${spot.id}`}
                  position={[spot.location.lat, spot.location.lng]}
                  icon={createCommunitySpotIcon(spot.category, isSelected)}
                  eventHandlers={{
                    click: () => setSelectedCommunitySpot(spot)
                  }}
                >
                  <Popup>
                    <div className="p-2 min-w-[200px] max-w-[260px] text-xs font-sans">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white ${getSpotCategoryBg(spot.category)}`}>
                          {getSpotCategoryIcon(spot.category)} {getSpotCategoryLabel(spot.category)}
                        </span>
                        <span className="text-[10px] text-slate-500 font-bold flex items-center gap-0.5">
                          👍 {spot.upvotes || 0}
                        </span>
                      </div>
                      
                      <h4 className="font-black text-slate-900 text-sm leading-snug mb-1">{spot.title}</h4>
                      <p className="text-slate-600 text-xs mb-2 leading-relaxed">{spot.description}</p>
                      
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-100 mb-2">
                        <span>By {spot.reporterName || 'Resident'}</span>
                        <span className="font-semibold text-emerald-600">🛡️ Admin Verified</span>
                      </div>

                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleUpvoteSpot(spot.id)}
                          disabled={upvotingSpotId === spot.id || (user && spot.votedUsers?.includes(user.uid))}
                          className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 transition-all ${
                            user && spot.votedUsers?.includes(user.uid)
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs active:scale-95'
                          }`}
                        >
                          {user && spot.votedUsers?.includes(user.uid) ? '✓ Upvoted (+1)' : '👍 I Feel Safe (+1)'}
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => selectSpotDestination(spot)}
                          className="py-1.5 px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 shadow-xs active:scale-95"
                          title="Navigate to this spot"
                        >
                          <Navigation className="w-3 h-3" /> Go
                        </button>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

          {/* Start Point Pin */}
          {startPoint && !currentLoc && (
            <>
              <Marker position={startPoint} icon={startIcon}>
                <Popup><div className="text-xs font-bold text-slate-800">Start Origin (Point A)</div></Popup>
              </Marker>
              <Circle center={startPoint} radius={18} pathOptions={{ fillColor: '#3b82f6', fillOpacity: 0.3, color: '#2563eb', weight: 1.5 }} />
            </>
          )}

          {/* Target endpoint Pin */}
          {endPoint && (
            <>
              <Marker position={endPoint} icon={endIcon}>
                <Popup><div className="text-xs font-bold text-slate-800">Destination (Point B)</div></Popup>
              </Marker>
              <Circle center={endPoint} radius={18} pathOptions={{ fillColor: '#ef4444', fillOpacity: 0.3, color: '#ef4444', weight: 1.5 }} />
            </>
          )}

          {/* Real-Time Live User GPS Pinpoint & Precision Halo */}
          {liveGpsCoords && !isSimulating && (
            <>
              <Marker position={liveGpsCoords} icon={createLiveGpsPuckIcon(liveGpsHeading)}>
                <Popup>
                  <div className="text-xs p-1 min-w-[150px]">
                    <span className="font-bold text-blue-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping inline-block"></span>
                      Real-Time GPS Location
                    </span>
                    <p className="text-[10px] text-slate-600 mt-1 font-medium">
                      {liveGpsAccuracy ? `Precision: ±${Math.round(liveGpsAccuracy)} meters` : 'High-precision GPS'}
                    </p>
                    {liveGpsSpeed !== null && liveGpsSpeed > 0.3 && (
                      <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                        Moving: {(liveGpsSpeed * 3.6).toFixed(1)} km/h
                      </p>
                    )}
                    <button
                      onClick={() => setAutoFollowGps(!autoFollowGps)}
                      className={`mt-2 w-full py-1 px-2 rounded text-[10px] font-bold ${
                        autoFollowGps ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {autoFollowGps ? '✓ Auto-Follow On' : 'Enable Auto-Follow'}
                    </button>
                  </div>
                </Popup>
              </Marker>
              {liveGpsAccuracy && liveGpsAccuracy > 0 && (
                <Circle 
                  center={liveGpsCoords} 
                  radius={Math.min(Math.max(liveGpsAccuracy, 6), 60)} 
                  pathOptions={{ 
                    fillColor: '#3b82f6', 
                    fillOpacity: 0.12, 
                    color: '#2563eb', 
                    weight: 1.5,
                    dashArray: '2, 3'
                  }} 
                />
              )}
            </>
          )}

          {/* Active Navigation simulated GPS tracker */}
          {currentLoc && (
            <Marker position={currentLoc} icon={userIcon}>
              <Popup>
                <div className="text-xs p-0.5">
                  <span className="font-bold text-emerald-600 block">Live Safe Tracker</span>
                  <span className="text-[10px] text-slate-500">Real-Time telemetry</span>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Drawn routing path on streets */}
          {routeCalculated && startPoint && endPoint && routes.map((r, idx) => {
            const isSelected = idx === activeRouteIndex;
            const borderWeight = isSelected ? 10 : 5;
            const innerWeight = isSelected ? 5 : 2;
            const borderCol = isSelected ? '#0f172a' : '#cbd5e1';

            return (
              <React.Fragment key={`polyline-${idx}`}>
                {/* Contrast backup halo line */}
                <Polyline 
                  positions={r.coordinates}
                  eventHandlers={{ click: () => { if (!isSimulating) setActiveRouteIndex(idx); } }}
                  pathOptions={{
                    color: borderCol,
                    weight: borderWeight,
                    opacity: isSelected ? 0.9 : 0.3,
                    lineCap: 'round',
                    lineJoin: 'round'
                  }}
                />
                
                {/* Primary core color road line - segmented if selected, single-colored if unselected */}
                {isSelected && r.segments && r.segments.length > 0 ? (
                  r.segments.map((seg, sIdx) => (
                    <Polyline 
                      key={`polyline-seg-${idx}-${sIdx}`}
                      positions={seg.coordinates}
                      eventHandlers={{ click: () => { if (!isSimulating) setActiveRouteIndex(idx); } }}
                      pathOptions={{
                        color: seg.color,
                        weight: innerWeight,
                        opacity: 1.0,
                        lineCap: 'round',
                        lineJoin: 'round'
                      }}
                    />
                  ))
                ) : (
                  <Polyline 
                    positions={r.coordinates}
                    eventHandlers={{ click: () => { if (!isSimulating) setActiveRouteIndex(idx); } }}
                    pathOptions={{
                      color: isSelected 
                        ? (r.safety === 'danger' ? '#F97316' : r.safety === 'moderate' ? '#F59E0B' : '#10B981')
                        : '#94a3b8',
                      weight: innerWeight,
                      opacity: isSelected ? 1.0 : 0.4,
                      lineCap: 'round',
                      lineJoin: 'round'
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}

          {/* Temporary Pinpoint Preview Marker when picking spot location on map */}
          {spotCoords && (isAddSpotModalOpen || isPickingSpotOnMap) && (
            <Marker position={spotCoords} icon={createCommunitySpotIcon(spotCategory, true)}>
              <Popup autoPan={false}>
                <div className="p-1.5 text-center font-sans space-y-0.5">
                  <p className="font-extrabold text-xs text-emerald-700">📍 Selected Pinpoint Area</p>
                  <p className="text-[10px] text-slate-500 font-mono">[{spotCoords[0].toFixed(5)}, {spotCoords[1].toFixed(5)}]</p>
                </div>
              </Popup>
            </Marker>
          )}

        </MapContainer>

        {/* Banner Overlay when in Map Pinpoint mode for Resident Suggestion */}
        {isPickingSpotOnMap && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[3000] bg-emerald-600 text-white px-5 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-bounce border-2 border-white pointer-events-auto">
            <MapPin className="w-5 h-5 text-emerald-200 animate-pulse shrink-0" />
            <span className="font-extrabold text-xs">Tap anywhere on the map to pinpoint your suggested spot!</span>
            <button
              type="button"
              onClick={() => {
                setIsPickingSpotOnMap(false);
                setIsAddSpotModalOpen(true);
              }}
              className="bg-white/20 hover:bg-white/30 text-white text-[10px] font-black px-3 py-1 rounded-full transition cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}



        {/* Community Spots Pinpoint Control Bar & Legend */}
        <div id="community-spots-map-control" className={`absolute top-4 left-4 z-[990] rounded-2xl shadow-xl border p-2.5 max-w-xs transition-colors duration-300 ${
          darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white/95 backdrop-blur border-slate-200 text-slate-800'
        }`}>
          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 mb-2">
            <button
              type="button"
              onClick={() => setShowCommunitySpots(!showCommunitySpots)}
              className="flex items-center gap-1.5 text-xs font-black tracking-wide text-slate-800 hover:text-emerald-600 transition"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span>🌟 COMMUNITY SPOTS</span>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {activeApprovedSpots.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAddSpotModalOpen(false);
                setIsPickingSpotOnMap(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[10px] font-bold py-1 px-2.5 rounded-full flex items-center gap-1 shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-3 h-3" /> Pin Spot
            </button>
          </div>

          {showCommunitySpots && (
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'all', label: 'All', icon: '📍' },
                { id: 'safe_haven', label: 'Safe Haven', icon: '🛡️' },
                { id: 'well_lit', label: 'Well-Lit', icon: '💡' },
                { id: 'friendly_business', label: 'Store', icon: '🏪' },
                { id: 'community_hub', label: 'Hub', icon: '☕' },
                { id: 'enjoyed_spot', label: 'Enjoyed', icon: '🌟' }
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedSpotCategory(cat.id)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all ${
                    selectedSpotCategory === cat.id
                      ? 'bg-slate-900 text-white shadow-xs scale-105'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Floating current location + Map controls directly on bottom-right of map */}
        <FloatingMapControls 
          onRecenter={() => {
            setAutoFollowGps(true);
            handleLocateAndCenter();
          }}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          autoFollow={autoFollowGps}
          hasLiveGps={!!liveGpsCoords}
        />

        {/* Circles Risk Legend to sync with Admin Portal */}
        <div id="danger-zones-circles-legend" className={`absolute bottom-4 right-4 z-[999] rounded-2xl shadow-xl border p-3.5 w-44 text-left transition-colors duration-300 ${
          darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-800'
        }`}>
          <h4 className={`text-[10px] font-black tracking-wider uppercase mb-1.5 pb-1 border-b ${
            darkMode ? 'text-slate-300 border-slate-800' : 'text-slate-800 border-slate-150'
          }`}>
            CIRCLES LEGEND
          </h4>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0 shadow-xs border border-white" style={{ backgroundColor: '#10B981' }} />
              <span className={`text-[11px] font-bold ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>Low Risk (50m)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0 shadow-xs border border-white" style={{ backgroundColor: '#F59E0B' }} />
              <span className={`text-[11px] font-bold ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>Moderate (100m)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0 shadow-xs border border-white" style={{ backgroundColor: '#F97316' }} />
              <span className={`text-[11px] font-bold ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>High Risk (150m+)</span>
            </div>
          </div>
        </div>

        {/* Floating live Radar incident Warnings panel */}
        <AnimatePresence>
          {proximityAlert && (
            <motion.div 
              initial={{ y: -50, opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              exit={{ y: -50, opacity: 0 }} 
              className="absolute top-4 left-4 right-4 z-[1010]"
            >
              <div className="bg-red-500 text-white p-3 rounded-2xl shadow-xl flex items-start gap-2 border border-red-400">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 animate-bounce" />
                <div className="text-left">
                  <h4 className="text-[9px] uppercase font-bold tracking-wider leading-none mb-1 opacity-90">PROXIMITY WARNING ALERT</h4>
                  <p className="text-xs font-bold leading-relaxed">{proximityAlert}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Manual selection Map Tap indicator mode overlay */}
        {activeInputField && (
          <div className="absolute top-4 left-4 right-4 z-[990]">
            <div className="bg-blue-600 text-white px-4 py-2.5 rounded-full shadow-lg text-center flex items-center justify-center gap-2 border border-blue-400">
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <span className="text-xs font-bold">
                Tap on map to select {activeInputField === 'start' ? 'Start Location' : 'Destination Target'}
              </span>
              <button 
                onClick={() => setActiveInputField(null)}
                className="ml-auto p-1 text-white/85 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Drag/Collapse Route Planning Bottom Sheet - Google Maps style */}
      <motion.div 
        animate={{ height: isSheetExpanded ? '520px' : '230px' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        id="collapsible-route-sheet"
        className={`relative rounded-t-3xl border-t z-[999] shadow-2xl flex flex-col overflow-hidden max-w-md mx-auto w-full shrink-0 transition-colors duration-300 ${
          darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}
      >
        
        {/* DRAG / INTERACTION HEADER HANDLE BAR */}
        <div 
          onClick={() => setIsSheetExpanded(!isSheetExpanded)}
          className={`w-full py-3 border-b cursor-pointer flex flex-col justify-center items-center shrink-0 transition-colors duration-300 ${
            darkMode ? 'bg-slate-950 border-slate-850 hover:bg-slate-800/40' : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
          }`}
        >
          {/* Draggable visual handle */}
          <div className={`w-12 h-1 rounded-full mb-1.5 ${darkMode ? 'bg-slate-800' : 'bg-slate-300'}`} />
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {isSheetExpanded ? 'Collapse Navigation Control' : 'Expand Route Details'}
            </span>
            {isSheetExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-400" />}
          </div>
        </div>

        {/* SHEET SCROLLABLE MAIN BODY */}
        <div className={`flex-1 overflow-y-auto px-4 py-3 space-y-4 text-left ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
          
          {permissionError && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-amber-500 space-y-1.5 border-dashed"
            >
              <div className="flex items-center gap-1.5 font-bold uppercase text-[10px] tracking-wider">
                <AlertCircle className="w-4 h-4 text-amber-500 animate-pulse animate-duration-1000" />
                <span>Firestore Security Rules Required</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                SafeRoute is connected to your custom Firestore project (<code>saferouteapp-admin</code>). However, access is denied because the security rules on your GCP console are blocking read/list requests.
              </p>
              <p className="text-[11px] leading-relaxed font-semibold">
                Please open your Firebase Console &rarr; Firestore Database &rarr; Rules tab, and paste the contents of <code>firestore.rules</code> file from this workspace to authorize safe access!
              </p>
            </motion.div>
          )}

          {/* SEARCH & INPUT LINES - COLLAPSED STATE */}
          <div className="space-y-2.5">
            {/* Start point selector */}
            <div className="relative">
              <div className={`flex items-center gap-2.5 border rounded-2xl p-3 focus-within:ring-2 focus-within:ring-blue-500 transition-all ${
                darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                <input 
                  type="text"
                  placeholder="Start Location"
                  value={startQuery}
                  onChange={(e) => {
                    setStartQuery(e.target.value);
                    setShowStartSuggestions(true);
                  }}
                  onFocus={() => {
                    setShowStartSuggestions(true);
                    setShowEndSuggestions(false);
                    setIsSheetExpanded(false); // Collapsing slightly to avoid overlap
                  }}
                  className={`w-full bg-transparent text-xs focus:outline-none font-semibold ${
                    darkMode ? 'text-white placeholder:text-slate-500' : 'text-slate-800 placeholder:text-slate-400'
                  }`}
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button 
                    onClick={() => { setStartPoint(PALANAN_CENTER); setStartQuery('Palanar Barangay Hall (Current)'); }}
                    className={`p-1 ${darkMode ? 'text-slate-500 hover:text-blue-400' : 'text-slate-400 hover:text-blue-600'}`}
                    title="Use center position"
                  >
                    <Compass className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setActiveInputField('start')}
                    className={`p-1 ${activeInputField === 'start' ? 'text-blue-500' : (darkMode ? 'text-slate-500 hover:text-blue-400' : 'text-slate-400 hover:text-blue-600')}`}
                    title="Tap coordinates on map"
                  >
                    <MapPin className="w-4 h-4" />
                  </button>
                  {startPoint && (
                    <button onClick={handleClearStartPoint} className={`p-1 ${darkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Start autocomplete suggestion overlay list */}
              {showStartSuggestions && startQuery.length > 0 && (
                <div className={`absolute left-0 right-0 top-full mt-1 border shadow-xl rounded-2xl p-1.5 z-50 max-h-40 overflow-y-auto divide-y ${
                  darkMode ? 'bg-slate-900 border-slate-800 divide-slate-800/40' : 'bg-white border-slate-200 divide-slate-50'
                }`}>
                  {startPlacesFiltered.length > 0 ? (
                    startPlacesFiltered.map((p, i) => (
                      <button
                        key={`start-p-${i}`}
                        onClick={() => {
                          setStartPoint(p.latLng);
                          setStartQuery(p.name);
                          setShowStartSuggestions(false);
                        }}
                        className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2 ${
                          darkMode ? 'hover:bg-slate-850' : 'hover:bg-slate-50'
                        }`}
                      >
                        <MapPinned className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                          <p className={`text-xs font-bold ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>{p.name}</p>
                          <p className="text-[10px] text-slate-400">{p.address}</p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="p-2.5 text-xs text-slate-400 text-center">No landmarks matching input found. Click map pin above to point select or type street names.</div>
                  )}
                </div>
              )}
            </div>

            {/* Destination point selector */}
            <div className="relative">
              <div className={`flex items-center gap-2.5 border rounded-2xl p-3 focus-within:ring-2 focus-within:ring-blue-500 transition-all ${
                darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                <input 
                  type="text"
                  placeholder="Street destination"
                  value={endQuery}
                  onChange={(e) => {
                    setEndQuery(e.target.value);
                    setShowEndSuggestions(true);
                  }}
                  onFocus={() => {
                    setShowEndSuggestions(true);
                    setShowStartSuggestions(false);
                    setIsSheetExpanded(false);
                  }}
                  className={`w-full bg-transparent text-xs focus:outline-none font-semibold ${
                    darkMode ? 'text-white placeholder:text-slate-500' : 'text-slate-800 placeholder:text-slate-400'
                  }`}
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button 
                    onClick={() => setActiveInputField('end')}
                    className={`p-1 ${activeInputField === 'end' ? 'text-red-500' : (darkMode ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-600')}`}
                    title="Tap coordinates on map"
                  >
                    <MapPin className="w-4 h-4" />
                  </button>
                  {endPoint && (
                    <button onClick={handleClearEndPoint} className={`p-1 ${darkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* End autocomplete suggestion overlay list */}
              {showEndSuggestions && endQuery.length > 0 && (
                <div className={`absolute left-0 right-0 top-full mt-1 border shadow-xl rounded-2xl p-1.5 z-50 max-h-40 overflow-y-auto divide-y ${
                  darkMode ? 'bg-slate-900 border-slate-800 divide-slate-800/40' : 'bg-white border-slate-200 divide-slate-50'
                }`}>
                  {endPlacesFiltered.length > 0 ? (
                    endPlacesFiltered.map((p, i) => (
                      <button
                        key={`end-p-${i}`}
                        onClick={() => {
                          setEndPoint(p.latLng);
                          setEndQuery(p.name);
                          setShowEndSuggestions(false);
                        }}
                        className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2 ${
                          darkMode ? 'hover:bg-slate-850' : 'hover:bg-slate-50'
                        }`}
                      >
                        <MapPinned className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <p className={`text-xs font-bold ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>{p.name}</p>
                          <p className="text-[10px] text-slate-400">{p.address}</p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="p-2.5 text-xs text-slate-400 text-center">No landmarks matching input found. Click map pin above to point select or type street names.</div>
                  )}
                </div>
              )}
            </div>

            {/* Profile mode + Generate Button controls */}
            <div className="flex gap-2 items-center">
              <div className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 shrink-0 border transition-all ${
                darkMode ? 'bg-blue-950/40 border-blue-900/40' : 'bg-blue-50 border-blue-100'
              }`}>
                <User className={`w-4 h-4 animate-pulse animate-duration-[2000ms] ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                <div className="text-left">
                  <p className={`text-[10px] font-black uppercase leading-none ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>Profile</p>
                  <p className={`text-[11px] font-bold leading-tight ${darkMode ? 'text-blue-300' : 'text-blue-800'}`}>Walking</p>
                </div>
              </div>

              <button 
                onClick={() => calculateSafeDirections(startPoint, endPoint)}
                disabled={loading || !startPoint || !endPoint}
                className={`flex-1 disabled:opacity-50 font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 shadow transition-all ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-slate-950/40' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
                }`}
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
                <span>Generate Safe Route</span>
              </button>
            </div>
          </div>

          <div className={`border-t my-2 ${darkMode ? 'border-slate-800' : 'border-slate-100'}`} />

          {/* USER SAVED PLACES SYSTEM */}
          {!routeCalculated && (
            <div className="space-y-2">
              <div className="flex justify-between items-center mb-1 shrink-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">
                  Saved Places System
                </p>
                <button
                  type="button"
                  onClick={() => setIsManageModalOpen(true)}
                  className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? 'text-blue-400' : 'text-blue-600 hover:text-blue-700'}`}
                >
                  Manage Places
                </button>
              </div>

              {loadingSavedPlaces ? (
                <div className="py-4 text-center flex justify-center items-center gap-2">
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  <span className="text-[10px] font-semibold text-slate-400">Loading places...</span>
                </div>
              ) : (
                <div className="flex gap-2.5 overflow-x-auto pb-1 max-w-full scrollbar-hide shrink-0">
                  {savedPlaces.filter(place => place && place.location && typeof place.location.lat === 'number' && typeof place.location.lng === 'number').map((place) => (
                    <button
                      key={place.id}
                      type="button"
                      onClick={() => selectSavedPlaceCommute(place)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setEditingPlace(place);
                        setFormName(place.name);
                        setFormCategory(place.category);
                        setFormCoords([place.location.lat, place.location.lng]);
                        setFormAddress(place.address || '');
                        setIsAddModalOpen(true);
                      }}
                      className={`flex flex-col items-center justify-center p-2.5 border rounded-2xl min-w-[76px] transition-all cursor-pointer shadow-sm relative group active:scale-[0.97] ${
                        darkMode ? 'bg-slate-950 border-slate-800 text-slate-100 hover:bg-slate-800/60' : 'bg-slate-50 border-slate-205 text-slate-800 hover:bg-slate-100'
                      }`}
                      title="Tap to trigger automatic safe route navigation. Right click/Long press to edit."
                    >
                      <span className="text-xl mb-0.5">{place.icon}</span>
                      <span className={`text-[9px] font-bold line-clamp-1 text-center w-14 leading-tight ${darkMode ? 'text-slate-350' : 'text-slate-800'}`}>
                        {place.name}
                      </span>
                      <div className={`absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-full text-[8px] border ${
                        darkMode ? 'bg-slate-900/95 border-slate-800 text-slate-400 hover:text-blue-400' : 'bg-white/90 border-slate-200 text-slate-500 hover:text-blue-600'
                      }`}>
                        ✏️
                      </div>
                    </button>
                  ))}
                  
                  {/* Plus add place button */}
                  <button
                    onClick={() => {
                      setEditingPlace(null);
                      resetForm();
                      setIsAddModalOpen(true);
                    }}
                    type="button"
                    className={`flex flex-col items-center justify-center p-2.5 rounded-2xl min-w-[76px] transition-all cursor-pointer shadow-sm active:scale-[0.97] border border-dashed ${
                      darkMode ? 'bg-blue-950/20 border-blue-900/40 text-blue-400 hover:bg-blue-950/40' : 'bg-blue-50 border-blue-300 text-blue-600 hover:bg-blue-100'
                    }`}
                  >
                    <span className="text-xl mb-0.5 font-black leading-none">+</span>
                    <span className="text-[9px] font-black text-center w-14 leading-tight">Add Place</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* EXPANDED DETAILED STATE LAYOUT */}
          {routeCalculated && activeRoute ? (
            <div className="space-y-4">
              
              {/* PRIMARY ROUTE SUMMARY CARD & SAFETY METRICS */}
              <div className="bg-slate-950 text-white rounded-2xl p-4 shadow-xl border border-slate-800 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-400/30 px-2 py-0.5 rounded-lg text-blue-400 text-[10px] font-extrabold uppercase">
                    <Activity className="w-3 h-3" />
                    <span>Calculated Safe Path</span>
                  </div>
                  <div className="bg-emerald-500/20 border border-emerald-400 text-emerald-400 px-2.5 py-1 rounded-full text-xs font-black flex items-center gap-1 animate-pulse">
                    <Zap className="w-3 h-3 fill-emerald-400" />
                    <span>Safety Score: {activeScore}%</span>
                  </div>
                </div>

                <div className="flex justify-between items-end border-t border-white/10 pt-3">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">ROUTE DISTANCE</span>
                    <span className="text-lg font-black font-mono">{activeDistanceString}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">ESTIMATED TIME</span>
                    <span className="text-lg font-black font-mono text-emerald-300">{activeTimeString}</span>
                  </div>
                </div>

                {/* Safety Factors Dashboard factors matching active route */}
                <div className="bg-white/5 rounded-xl p-2.5 border border-white/10 space-y-1.5 text-[10px]">
                  <p className="font-extrabold uppercase tracking-wide text-indigo-300">Safety Score Breakdown Factors</p>
                  <div className="grid grid-cols-2 gap-1.5 px-1 text-slate-300">
                    <div>🔰 Route Risk Level: <strong className={activeRoute.safety === 'safe' ? 'text-emerald-400' : activeRoute.safety === 'moderate' ? 'text-amber-400' : 'text-red-400'}>{activeRoute.safety.toUpperCase()}</strong></div>
                    <div>🎯 Threat Zone Status: <strong className={activeRoute.safety === 'safe' ? 'text-emerald-400' : activeRoute.safety === 'moderate' ? 'text-amber-400' : 'text-red-400'}>{activeRoute.safety === 'safe' ? 'Fully Avoided' : activeRoute.safety === 'moderate' ? 'Near Perimeter' : 'Crosses Threat Zone'}</strong></div>
                    <div>🛡️ Active Threat Detour: <strong className="text-white">{activeRoute.name.includes("Detour") || activeRoute.safety === 'safe' ? 'Active Safe Bypass' : 'Direct Path'}</strong></div>
                    <div>🚨 Safety Rating Index: <strong className={activeScore >= 85 ? 'text-emerald-400' : activeScore >= 70 ? 'text-amber-400' : 'text-red-400'}>{activeScore}% Safe</strong></div>
                  </div>
                </div>
              </div>

              {/* MULTIPLE ALTERNATIVE PATHS SELECTOR */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">CALCULATED ROUTE OPTIONS</p>
                <div className="flex gap-2.5 overflow-x-auto pb-1 max-w-full scrollbar-hide">
                  {routes.map((r, idx) => {
                    const isSelected = idx === activeRouteIndex;
                    const isSafe = r.safety === 'safe';
                    const isModerate = r.safety === 'moderate';

                    return (
                      <button
                        key={`alt-choice-${idx}`}
                        onClick={() => setActiveRouteIndex(idx)}
                        className={`p-2.5 rounded-xl border flex-shrink-0 w-44 text-left transition-all relative ${
                          isSelected 
                            ? 'bg-blue-50/90 border-blue-600 text-blue-950 ring-2 ring-blue-500 shadow-sm' 
                            : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <span className={`text-[10px] font-black block leading-snug line-clamp-2 ${isSelected ? 'text-blue-950' : 'text-slate-800'}`}>
                          {r.name}
                        </span>
                        <div className="flex justify-between items-center mt-2 pt-1 border-t border-slate-200/60">
                          <span className="text-xs font-black font-mono">{(r.distance / 1000).toFixed(2)} km</span>
                          <span className={`text-[9px] font-black font-mono px-1.5 py-0.5 rounded-md border ${
                            isSafe 
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                              : isModerate 
                              ? 'bg-amber-100 text-amber-800 border-amber-300' 
                              : 'bg-red-100 text-red-800 border-red-300'
                          }`}>
                            {r.safetyScore}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* COMMUTE MOCK LIVE TRACKER CONTROLS */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <div>
                    <h5 className="font-black text-slate-900 uppercase">Commute Navigation Simulator</h5>
                    <p className="text-[9px] text-slate-400 mt-0.5">Simulate actual coordinate walking and hazard detection.</p>
                  </div>
                  <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${isSimulating ? 'bg-emerald-100 text-emerald-800 animate-pulse' : 'bg-slate-200 text-slate-400'}`}>
                    {isSimulating ? "NAVIGATING" : "STANDBY"}
                  </span>
                </div>

                {!isSimulating ? (
                  <button 
                    onClick={startSimulation}
                    className="w-full bg-slate-900 text-white hover:bg-slate-800 text-xs py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-98"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" /> Start Simulated Walk
                  </button>
                ) : (
                  <div className="space-y-2">
                    <button 
                      onClick={stopSimulation}
                      className="w-full bg-rose-600 hover:bg-rose-700 text-white text-xs py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm"
                    >
                      <Square className="w-3.5 h-3.5 fill-white" /> Halt Simulation
                    </button>
                    <button 
                      onClick={triggerDetour}
                      className="w-full bg-amber-500 hover:bg-amber-600 text-white text-[11px] py-1.5 rounded-xl font-extrabold flex items-center justify-center gap-1 transition-all active:scale-95"
                    >
                      <RotateCcw className="w-3.5 h-3.5 animate-spin-slow" /> Stray Off Route (Detour Trigger)
                    </button>
                  </div>
                )}
              </div>

              {/* TURN-BY-TURN ROUTE STEPS LIST */}
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Turn-by-Turn Safe Signals Node</p>
                <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto pr-1">
                  {activeRoute.steps.map((st, idx) => {
                    const totalCoords = activeRoute.coordinates.length;
                    const stepProgress = idx / activeRoute.steps.length;
                    const isPassed = isSimulating && (simulatedIndex / totalCoords > stepProgress);
                    const isCurrent = isSimulating && (simulatedIndex / totalCoords >= stepProgress) && (simulatedIndex / totalCoords < (idx + 1) / activeRoute.steps.length);

                    return (
                      <div 
                        key={`step-list-${idx}`} 
                        className={`py-2 text-[11px] flex gap-2 items-start transition-all p-1 ${
                          isCurrent ? 'bg-blue-50 border-l-2 border-blue-600 font-extrabold text-blue-950 rounded-r-lg' :
                          isPassed ? 'opacity-30 text-slate-400Line' : 'text-slate-700'
                        }`}
                      >
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isCurrent ? 'text-blue-600' : 'text-slate-400'}`} />
                        <div>
                          <p className="leading-snug">{st.instruction}</p>
                          {st.distance > 0 && (
                            <span className="text-[8px] font-mono text-slate-400 mt-1 block">Proceed {Math.round(st.distance)}m</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reset Map Action */}
              <button 
                onClick={resetMapForm}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-2xl font-black flex items-center justify-center gap-1.5 transition-all text-xs border border-slate-200"
              >
                <X className="w-3.5 h-3.5" /> Reset Nav Panel & Map
              </button>

            </div>
          ) : (
            
            /* EMPTY STATE SCREEN - Plan Your Safe Route */
            <div id="palanan-map-empty-state-panel" className="flex flex-col justify-center items-center py-4 text-center space-y-3 select-none">
              <div className="p-4 bg-blue-50 text-blue-600 rounded-full">
                <MapIcon className="w-8 h-8 animate-bounce text-blue-600" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-800">🗺️ Plan Your Safe Route</h3>
                <div className="text-[11px] text-slate-500 max-w-[270px] leading-relaxed mx-auto space-y-1 mt-1 text-left bg-slate-50 p-3 rounded-2xl border border-slate-150">
                  <div className="flex items-center gap-2"><span className="w-4 h-4 bg-blue-100 text-blue-600 text-[9px] font-bold flex items-center justify-center rounded-full">1</span> <span>Select Start Location</span></div>
                  <div className="flex items-center gap-2"><span className="w-4 h-4 bg-blue-100 text-blue-600 text-[9px] font-bold flex items-center justify-center rounded-full">2</span> <span>Select Destination</span></div>
                  <div className="flex items-center gap-2"><span className="w-4 h-4 bg-blue-100 text-blue-600 text-[9px] font-bold flex items-center justify-center rounded-full">3</span> <span>Generate Route</span></div>
                </div>
                <p className="text-[10px] text-slate-400 mt-3 max-w-[240px] mx-auto text-center leading-relaxed font-semibold">
                  SafeRoute Lite will recommend the safest available route within Barangay Palanan.
                </p>
              </div>
            </div>
          )}

        </div>

      </motion.div>

      {/* ADD/EDIT PLACE MODAL OVERLAY */}
      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs z-[3000] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-hidden font-sans"
          >
            <motion.div 
              initial={{ y: '100%' }} 
              animate={{ y: 0 }} 
              exit={{ y: '100%' }} 
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              onWheel={(e) => e.stopPropagation()}
              className={`rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto space-y-4 text-left border-t sm:border transition-colors duration-300 pb-24 sm:pb-6 overscroll-contain ${
                darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200'
              }`}
            >
              <div className={`flex justify-between items-center pb-2 border-b ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <h3 className={`text-sm font-black ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                  {editingPlace ? '✏️ Edit Saved Place' : '➕ Add Saved Place'}
                </h3>
                <button 
                  type="button"
                  onClick={() => { setIsAddModalOpen(false); resetForm(); }}
                  className={`p-1.5 rounded-full transition-colors ${
                    darkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSavePlace} className="space-y-4">
                
                {/* Place Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-sans">Place Name</label>
                  <input 
                    type="text"
                    placeholder="e.g. My Home, School, Barangay Hall, Cafe Spot"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className={`w-full focus:ring-2 focus:ring-blue-500 rounded-xl p-3 text-xs font-semibold focus:outline-none border transition-all ${
                      darkMode ? 'bg-slate-950 border-slate-800 text-white placeholder:text-slate-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400'
                    }`}
                    required
                  />
                </div>

                {/* Place Category Selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-sans">Choose Category</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { type: 'home', label: 'Home', icon: '🏠' },
                      { type: 'store', label: 'Store', icon: '🛒' },
                      { type: 'favorite', label: 'Favorite', icon: '⭐' },
                      { type: 'custom', label: 'Custom', icon: '📍' }
                    ].map((it) => (
                      <button
                        key={it.type}
                        type="button"
                        onClick={() => setFormCategory(it.type as PlaceCategory)}
                        className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all text-xs font-bold leading-none ${
                          formCategory === it.type 
                            ? (darkMode ? 'bg-blue-950/50 border-blue-500 text-blue-400 ring-1 ring-blue-500 font-black' : 'bg-blue-50 border-blue-600 text-blue-600 ring-1 ring-blue-500') 
                            : (darkMode ? 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-500')
                        }`}
                      >
                        <span className="text-lg">{it.icon}</span>
                        <span className="text-[8px] font-bold opacity-90">{it.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Location Picker */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-sans">Location Coordinates Picker</label>
                  
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setFormCoords(PALANAN_CENTER);
                        setFormAddress('Barangay Hall, Palanan, Makati');
                      }}
                      className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 font-bold transition-all ${
                        formCoords && formCoords[0] === PALANAN_CENTER[0] && formCoords[1] === PALANAN_CENTER[1]
                          ? (darkMode ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400' : 'bg-emerald-50 border-emerald-500 text-emerald-700')
                          : (darkMode ? 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-650')
                      }`}
                    >
                      <Compass className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Barangay Center</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsPickingCoordsOnMap(true);
                        setIsAddModalOpen(false);
                        setActiveInputField('end'); // redirects click listeners to select end point
                      }}
                      className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 font-bold transition-all ${
                        isPickingCoordsOnMap
                          ? (darkMode ? 'bg-blue-950/50 border-blue-500 text-blue-400 font-extrabold' : 'bg-blue-50 border-blue-500 text-blue-750')
                          : (darkMode ? 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-650')
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      <span>Tap Map Area</span>
                    </button>
                  </div>

                  {/* Landmark search autocomplete */}
                  <div className="relative mt-2">
                    <label className="text-[9px] font-bold text-slate-400 block mb-1">Search Barangay Landmark</label>
                    <div className={`flex border focus-within:ring-1 focus-within:ring-blue-500 rounded-xl p-2 items-center gap-2 transition-all ${
                      darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-100'
                    }`}>
                      <Search className="w-3.5 h-3.5 text-slate-400" />
                      <input 
                        type="text"
                        placeholder="Type landmark (e.g. Cash & Carry)"
                        className={`w-full bg-transparent text-xs font-semibold focus:outline-none ${
                          darkMode ? 'text-white placeholder:text-slate-500' : 'text-slate-800 placeholder:text-slate-400'
                        }`}
                        onChange={(e) => {
                          const queryStr = e.target.value.toLowerCase();
                          if (queryStr.length > 1) {
                            const match = PALANAN_PLACES.find(p => p.name.toLowerCase().includes(queryStr));
                            if (match) {
                              setFormCoords(match.latLng);
                              setFormAddress(match.address);
                            }
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Active Coordinates Display */}
                  <div className={`border rounded-2xl p-3 space-y-1 transition-all ${
                    darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-100'
                  }`}>
                    <p className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-blue-500 animate-ping" />
                      Bound Location Pin
                    </p>
                    {formCoords ? (
                      <div>
                        <p className={`text-[11px] font-bold leading-none ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                          {formCoords[0].toFixed(5)}, {formCoords[1].toFixed(5)}
                        </p>
                        <p className="text-[9px] text-slate-400 mt-0.5 truncate">{formAddress || 'Custom coordinates pin location'}</p>
                      </div>
                    ) : (
                      <p className="text-[9px] font-semibold text-rose-500">Pick coords using options above!</p>
                    )}
                  </div>
                </div>

                {/* Form Actions */}
                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => { setIsAddModalOpen(false); resetForm(); }}
                    className={`flex-1 py-3 rounded-2xl font-bold transition-all text-xs ${
                      darkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-750'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!formCoords || !formName.trim()}
                    className="flex-1 bg-blue-600 disabled:opacity-50 text-white hover:bg-blue-700 active:scale-95 transition-all font-black py-3 rounded-2xl text-xs flex items-center justify-center gap-1 shadow-md"
                  >
                    {editingPlace ? 'Update Place' : 'Save New Place'}
                  </button>
                </div>

              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MANAGE SAVED PLACES OVERLAY */}
      <AnimatePresence>
        {isManageModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs z-[3000] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-hidden font-sans"
          >
            <motion.div 
              initial={{ y: '100%' }} 
              animate={{ y: 0 }} 
              exit={{ y: '100%' }} 
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              onWheel={(e) => e.stopPropagation()}
              className={`rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto space-y-4 text-left border-t sm:border transition-colors duration-300 pb-24 sm:pb-6 overscroll-contain ${
                darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200'
              }`}
            >
              <div className={`flex justify-between items-center pb-2 border-b ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <h3 className={`text-sm font-black flex items-center gap-1.5 ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                  🛠️ Manage Saved Places
                </h3>
                <button 
                  type="button"
                  onClick={() => setIsManageModalOpen(false)}
                  className={`p-1.5 rounded-full transition-colors ${
                    darkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">
                Favorites Index (Sorted by Usage and Categories)
              </p>

              {loadingSavedPlaces ? (
                <div className="py-8 text-center flex justify-center items-center gap-1.5">
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  <span className="text-xs font-semibold text-slate-400">Loading places...</span>
                </div>
              ) : savedPlaces.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-xs text-slate-400 italic">No saved places found.</p>
                </div>
              ) : (
                <div className={`divide-y max-h-[300px] overflow-y-auto space-y-1.5 pr-1.5 ${darkMode ? 'divide-slate-800/80' : 'divide-slate-100'}`}>
                  {savedPlaces.filter(pl => pl && pl.location && typeof pl.location.lat === 'number' && typeof pl.location.lng === 'number').map((pl) => (
                    <div key={pl.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-start gap-2 max-w-[65%]">
                        <span className="text-xl mt-0.5">{pl.icon}</span>
                        <div className="min-w-0">
                          <h4 className={`text-xs font-black truncate leading-snug ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>{pl.name}</h4>
                          <p className="text-[10px] text-slate-400 truncate leading-none mt-0.5">{pl.address || 'Custom Coordinate Map Pin'}</p>
                          <div className={`mt-1 flex items-center gap-1 text-[8px] font-black uppercase rounded px-1.5 py-0.5 w-max ${
                            darkMode ? 'text-emerald-400 bg-emerald-950/40' : 'text-emerald-600 bg-emerald-50'
                          }`}>
                            ⭐ {pl.useCount} Navigations
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPlace(pl);
                            setFormName(pl.name);
                            setFormCategory(pl.category);
                            setFormCoords([pl.location.lat, pl.location.lng]);
                            setFormAddress(pl.address || '');
                            setIsManageModalOpen(false);
                            setIsAddModalOpen(true);
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                            darkMode 
                              ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-blue-400 hover:border-slate-650' 
                              : 'bg-slate-100 border-slate-200 hover:bg-blue-50 text-slate-700 hover:text-blue-600 hover:border-blue-250'
                          }`}
                        >
                          Edit
                        </button>
                        {deleteConfirmId === pl.id ? (
                          <div className="flex gap-1 items-center animate-pulse">
                            <button
                              type="button"
                              onClick={async () => {
                                await handleDeletePlace(pl.id);
                                setDeleteConfirmId(null);
                              }}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-[9px] transition-all"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className={`px-1.5 py-1 font-bold rounded text-[9px] transition-all ${
                                darkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-750'
                              }`}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(pl.id)}
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                              darkMode 
                                ? 'bg-rose-950/20 border-rose-900/40 text-rose-400 hover:bg-rose-950/40' 
                                : 'bg-rose-50 border-rose-100 hover:bg-rose-100 text-rose-600'
                            }`}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsManageModalOpen(false);
                  setEditingPlace(null);
                  resetForm();
                  setIsAddModalOpen(true);
                }}
                className="w-full bg-blue-600 text-white hover:bg-blue-700 text-xs py-3 rounded-2xl font-black flex items-center justify-center gap-1 transition-all shadow"
              >
                ➕ Create Custom Saved Place
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PIN COMMUNITY SPOT MODAL OVERLAY */}
      <AnimatePresence>
        {isAddSpotModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs z-[3000] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-hidden font-sans"
          >
            <motion.div 
              initial={{ y: '100%' }} 
              animate={{ y: 0 }} 
              exit={{ y: '100%' }} 
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              onWheel={(e) => e.stopPropagation()}
              className={`rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 w-full max-w-md max-h-[85vh] overflow-y-auto space-y-4 text-left border-t sm:border transition-colors duration-300 pb-28 sm:pb-6 overscroll-contain ${
                darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200'
              }`}
            >
              <div className={`flex justify-between items-center pb-2 border-b ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <h3 className={`text-sm font-black flex items-center gap-1.5 ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                  🌟 Pin a Community Spot
                </h3>
                <button 
                  type="button"
                  onClick={() => setIsAddSpotModalOpen(false)}
                  className={`p-1.5 rounded-full transition-colors ${
                    darkMode ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-slate-500 font-medium">
                Share places where residents feel safe, well-lit, or enjoy gathering in Barangay Palanan.
              </p>

              <div className={`p-2.5 rounded-2xl text-xs flex items-center gap-2 font-medium ${
                isAdmin 
                  ? 'bg-purple-50 text-purple-900 border border-purple-200' 
                  : 'bg-amber-50 text-amber-900 border border-amber-200'
              }`}>
                <span>
                  {isAdmin 
                    ? '🛡️ Admin Mode: Submitting will publish this spot directly to the public map.' 
                    : '📩 Resident Mode: Your suggested spot will be sent to the Admin Portal for review before appearing on the public map.'}
                </span>
              </div>

              <form onSubmit={handleCreateCommunitySpot} className="space-y-4">
                {/* Spot Title */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-sans">Spot Name / Title</label>
                  <input 
                    type="text"
                    required
                    placeholder="e.g. Well-Lit Walkway on Edison St"
                    value={spotTitle}
                    onChange={(e) => setSpotTitle(e.target.value)}
                    className={`w-full border rounded-2xl p-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      darkMode ? 'bg-slate-950 border-slate-800 text-white placeholder:text-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'
                    }`}
                  />
                </div>

                {/* Spot Category Selector */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-sans">Category</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { type: 'safe_haven', label: '🛡️ Safe Haven', desc: 'Manned, police outpost, 24/7 help' },
                      { type: 'well_lit', label: '💡 Well-Lit Pathway', desc: 'Bright LED lights, clear visibility' },
                      { type: 'friendly_business', label: '🏪 Friendly Store', desc: 'Open 24/7, welcoming shop' },
                      { type: 'community_hub', label: '☕ Community Hub', desc: 'Active gathering, sports, parks' },
                      { type: 'enjoyed_spot', label: '🌟 Enjoyed Spot', desc: 'Scenic garden, quiet walk' }
                    ].map((cat) => (
                      <button
                        key={cat.type}
                        type="button"
                        onClick={() => setSpotCategory(cat.type as CommunitySpotCategory)}
                        className={`p-2.5 rounded-2xl border text-left flex flex-col gap-0.5 transition-all text-xs font-bold ${
                          spotCategory === cat.type
                            ? 'bg-emerald-50 border-emerald-600 text-emerald-800 ring-2 ring-emerald-500/30'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="font-extrabold text-slate-900">{cat.label}</span>
                        <span className="text-[9px] font-normal text-slate-500 leading-tight">{cat.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-sans">Why do you feel safe / enjoy here?</label>
                  <textarea 
                    rows={2}
                    placeholder="Describe lighting, CCTV, staff, foot traffic or scenery..."
                    value={spotDescription}
                    onChange={(e) => setSpotDescription(e.target.value)}
                    className={`w-full border rounded-2xl p-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      darkMode ? 'bg-slate-950 border-slate-800 text-white placeholder:text-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'
                    }`}
                  />
                </div>

                {/* Location Display & Pinpoint Action */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-sans">
                    Pinpoint Area on Map
                  </label>
                  
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddSpotModalOpen(false);
                      setIsPickingSpotOnMap(true);
                    }}
                    className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer"
                  >
                    <MapPin className="w-4 h-4 animate-bounce" />
                    {spotCoords ? '📍 Change Pinpoint Location on Map' : '📍 Tap Here to Pinpoint Location directly on Map'}
                  </button>

                  {spotCoords ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-2xl flex items-center justify-between text-xs text-emerald-900 shadow-xs">
                      <div className="space-y-0.5">
                        <p className="font-extrabold text-[11px] text-emerald-800 flex items-center gap-1">
                          <span>✅ Exact Pinpoint Set</span>
                        </p>
                        <p className="text-[10px] font-mono text-emerald-700">
                          [{spotCoords[0].toFixed(5)}, {spotCoords[1].toFixed(5)}] {spotAddress}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddSpotModalOpen(false);
                          setIsPickingSpotOnMap(true);
                        }}
                        className="text-[10px] font-extrabold bg-emerald-600 text-white px-2.5 py-1 rounded-xl hover:bg-emerald-700 transition"
                      >
                        Re-pin
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-1">
                      <p className="text-[11px] font-extrabold text-amber-800">
                        ⚠️ No Location Pinpointed Yet
                      </p>
                      <p className="text-[10px] text-amber-700">
                        Tap the green button above or choose a landmark below to set your spot.
                      </p>
                    </div>
                  )}

                  <div className="pt-1">
                    <span className="text-[9px] font-bold text-slate-400 block mb-1">Quick Landmark Presets:</span>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {PALANAN_PLACES.slice(0, 5).map((pl) => (
                        <button
                          key={pl.name}
                          type="button"
                          onClick={() => {
                            setSpotCoords(pl.latLng);
                            setSpotAddress(pl.address);
                          }}
                          className={`px-2.5 py-1.5 rounded-xl border text-[10px] font-bold shrink-0 transition ${
                            spotCoords && spotCoords[0] === pl.latLng[0] && spotCoords[1] === pl.latLng[1]
                              ? 'bg-emerald-100 border-emerald-500 text-emerald-800 font-black ring-2 ring-emerald-500/20'
                              : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          📍 {pl.name.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Submit buttons */}
                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAddSpotModalOpen(false)}
                    className="flex-1 py-3 rounded-2xl font-bold bg-slate-100 text-slate-700 text-xs hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!spotCoords || !spotTitle.trim()}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white disabled:opacity-50 font-black py-3 rounded-2xl text-xs flex items-center justify-center gap-1 shadow-md transition-all"
                  >
                    {isAdmin ? '🌟 Publish Spot Directly' : '📩 Submit Suggestion'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HIGH-VISIBILITY GPS STATUS & PERMISSION TOAST BANNER */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="absolute top-3 left-3 right-3 z-[4000] max-w-sm mx-auto shadow-2xl"
          >
            <div className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 backdrop-blur-md ${
              toastMessage.includes('⚠️') || toastMessage.includes('denied') || toastMessage.includes('unavailable')
                ? 'bg-amber-950/90 border-amber-500/50 text-amber-100 shadow-amber-900/30'
                : toastMessage.includes('📍') || toastMessage.includes('Located')
                  ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100 shadow-emerald-900/30'
                  : 'bg-slate-900/95 border-slate-700 text-white shadow-black/40'
            }`}>
              <div className="text-lg shrink-0 mt-0.5">
                {toastMessage.includes('⚠️') || toastMessage.includes('denied') ? (
                  <ShieldAlert className="w-5 h-5 text-amber-400 animate-pulse" />
                ) : toastMessage.includes('📍') || toastMessage.includes('Located') ? (
                  <MapPin className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Compass className="w-5 h-5 text-blue-400 animate-spin" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-black uppercase tracking-wider opacity-80 mb-0.5">
                  {toastMessage.includes('denied') || toastMessage.includes('permission')
                    ? 'Location Permission Notice'
                    : toastMessage.includes('Located')
                      ? 'GPS Signal Locked'
                      : 'GPS Tracking Update'}
                </p>
                <p className="text-xs font-semibold leading-relaxed break-words">
                  {toastMessage.replace(/^[⚠️📍🛰️]\s*/, '')}
                </p>
                {(toastMessage.includes('permission') || toastMessage.includes('denied')) && (
                  <div className="mt-2 pt-2 border-t border-amber-500/30 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-amber-200/90">Turn on Phone GPS & tap Allow in browser</span>
                    <button
                      onClick={handleLocateAndCenter}
                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black rounded-lg text-[10px] shrink-0 transition"
                    >
                      Retry GPS
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => setToastMessage(null)}
                className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 shrink-0 transition"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SafeRoute Lite Location Accuracy Dialog */}
      <LocationAccuracyModal
        isOpen={showLocationAccuracyModal}
        onTurnOn={handleTurnOnLocationAccuracy}
        onDismiss={handleDismissLocationAccuracy}
      />

    </div>
  );
}
