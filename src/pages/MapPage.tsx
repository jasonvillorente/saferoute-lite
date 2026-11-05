import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents, Polyline, useMap } from 'react-leaflet';
import { collection, query, where, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, doc, Timestamp, getDocs } from 'firebase/firestore';
import L from 'leaflet';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/error-handler';
import { useAuth } from '../context/AuthContext';
import { 
  Report, 
  DangerZone, 
  SavedPlace, 
  PlaceCategory, 
  safeGetCoords, 
  CommunitySpot, 
  CommunitySpotCategory, 
  isZoneResolved,
  CalculatedRoute,
  SafetyLevel,
  RouteSegment
} from '../types';
import { isDemoMode as checkDemoMode } from '../config/demo';
import { isInsidePalanan, PALANAN_BOUNDS, PALANAN_CENTER } from '../lib/palananBounds';
import { useLocationTracker } from '../hooks/useLocationTracker';
import { UserLocationMarker } from '../components/UserLocationMarker';
import { GpsStatusChip } from '../components/GpsStatusChip';
import { getDistanceToRouteMeters } from '../utils/offRouteDetector';
import { getRouteStartFromGps, GpsStartResult } from '../utils/gpsRouting';
import { ZONE_LABEL, ZONE_LABEL_PLURAL, CAUTION_AREA_LABEL } from '../constants/labels';
import { 
  normalizeDangerZone, 
  isZoneActiveNow, 
  isZoneCurrentlyActive,
  getSourceLabel, 
  formatActiveTimeWindow, 
  formatIncidentCountText, 
  getZoneMapStyles, 
  escapeHtml,
  ZONE_COLOR
} from '../utils/zoneUtils';
import {
  generateSuggestedRoutes,
  processRoutePipeline,
  computeRouteZoneMetrics,
  computeInZonePolylinesAtRenderTime,
  InZonePolylineSegment,
  areRoutesNearDuplicates,
  getDistanceMeters,
  getMinDistanceToSegmentMeters,
  getDemoTripSavedRoutes,
  RawRouteCandidate
} from '../utils/routeUtils';
import { isSpotVisibleOnMap, isSpotAuthorPending } from '../utils/communitySpotUtils';
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
  Clock,
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

// Leaflet markers shadow url
const markerShadow = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

const createCommunitySpotIcon = (category: CommunitySpotCategory, isSelected: boolean = false, isPending: boolean = false) => {
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

  if (isPending) {
    badgeColor = '#d97706'; // amber-600
    badgeBorder = '#b45309'; // amber-700
  }

  const pulseClass = isSelected ? 'scale-125 z-50 ring-4 ring-emerald-400 rounded-full' : '';
  const dashedClass = isPending ? 'border-2 border-dashed border-amber-300 ring-2 ring-amber-400/50' : 'border-2';

  return L.divIcon({
    html: `
      <div class="relative flex flex-col items-center group cursor-pointer ${pulseClass}">
        <div class="w-9 h-9 rounded-full flex items-center justify-center text-base shadow-xl ${dashedClass} transition-transform duration-200 group-hover:scale-110"
             style="background-color: ${badgeColor}; border-color: ${badgeBorder}; color: white;">
          ${emoji}
        </div>
        <div class="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[7px]"
             style="border-t-color: ${badgeColor}; margin-top: -1px;">
        </div>
        ${isPending ? `<div class="absolute -top-1.5 -right-1.5 bg-amber-500 text-[9px] font-black text-white px-1 py-0.2 rounded-full border border-white shadow-xs leading-none">⏳</div>` : ''}
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
const createLiveGpsPuckIcon = (heading: number | null = null, isOutside: boolean = false) => {
  const hasHeading = typeof heading === 'number' && !isNaN(heading);
  const headingTransform = hasHeading ? `transform: rotate(${heading}deg);` : '';
  const mainColor = isOutside ? '#ef4444' : '#3b82f6';
  const pingColor = isOutside ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.3)';
  const pulseColor = isOutside ? 'rgba(239, 68, 68, 0.5)' : 'rgba(59, 130, 246, 0.4)';
  const coreBg = isOutside ? 'bg-red-600' : 'bg-blue-600';

  return L.divIcon({
    html: `
      <div class="relative flex items-center justify-center w-10 h-10 -ml-5 -mt-5">
        ${hasHeading ? `
          <div class="absolute -top-3 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[12px] opacity-90" style="border-b-color: ${mainColor}; ${headingTransform} transform-origin: 50% 20px;"></div>
        ` : ''}
        <span class="absolute w-8 h-8 rounded-full animate-ping" style="background-color: ${pingColor};"></span>
        <span class="absolute w-6 h-6 rounded-full" style="background-color: ${pulseColor};"></span>
        <div class="relative w-4 h-4 rounded-full ${coreBg} border-2 border-white shadow-md flex items-center justify-center">
          <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
        </div>
        ${isOutside ? `
          <div class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-600 border border-white flex items-center justify-center text-[9px] text-white shadow-xs font-bold leading-none animate-bounce">!</div>
        ` : ''}
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

// Shared bounds and center imported from ../lib/palananBounds

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

// Types and distance utilities imported from ../types and ../utils/routeUtils

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

// Dedicated Leaflet Panes initializer: guarantees panes exist immediately with proper zIndex and pointer-events
function MapPanesSetup() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (!map.getPane('dangerZonesPane')) {
      const p = map.createPane('dangerZonesPane');
      p.style.zIndex = '350';
    }
    if (!map.getPane('routeUnderlayPane')) {
      const p = map.createPane('routeUnderlayPane');
      p.style.zIndex = '450';
    }
    if (!map.getPane('inZoneHeatmapPane')) {
      const p = map.createPane('inZoneHeatmapPane');
      p.style.zIndex = '620';
      p.style.pointerEvents = 'none';
    }
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
  hasLiveGps,
  isOutsidePalanan
}: { 
  onRecenter: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  autoFollow?: boolean;
  hasLiveGps?: boolean;
  isOutsidePalanan?: boolean;
}) {
  const darkMode = false;
  return (
    <div className="absolute bottom-72 right-4 flex flex-col gap-2 z-[999]">
      {/* Current Location / Recenter with Outside Palanan Warning Indicator */}
      <div className="relative">
        <button 
          onClick={onRecenter}
          id="btn-recenter-map"
          className={`p-3 rounded-full shadow-lg border transition-all active:scale-95 flex items-center justify-center w-11 h-11 cursor-pointer ${
            isOutsidePalanan
              ? 'bg-red-600 border-red-500 text-white shadow-red-500/40 ring-4 ring-red-400/40 animate-pulse'
              : autoFollow 
                ? 'bg-blue-600 border-blue-500 text-white shadow-blue-500/30' 
                : darkMode 
                  ? 'bg-slate-900 border-slate-800 text-blue-400 hover:bg-slate-800' 
                  : 'bg-white border-slate-200 text-blue-600 hover:bg-slate-50'
          }`}
          title={isOutsidePalanan ? "You are outside Barangay Palanan (Click to view notice)" : autoFollow ? "Auto-following location (Click to center)" : "Find Me & Center Location"}
        >
          <Compass className={`w-5 h-5 ${hasLiveGps ? 'animate-pulse' : ''} text-white`} />
        </button>
        {isOutsidePalanan && (
          <span 
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 border-2 border-white flex items-center justify-center text-[10px] font-black text-white shadow-md animate-bounce"
            title="Outside Barangay Palanan"
          >
            !
          </span>
        )}
      </div>

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

export default function MapPage() {
  const darkMode = false;
  const [zones, setZones] = useState<DangerZone[]>([]);
  const [permissionError, setPermissionError] = useState(false);
  const [clockTick, setClockTick] = useState(0);

  // 1-minute clock tick to re-evaluate active time windows in real time while app is open
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTick(prev => prev + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Navigation markers
  const [startPoint, setStartPoint] = useState<[number, number] | null>(null);
  const [endPoint, setEndPoint] = useState<[number, number] | null>(null);
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');
  const [isStartLinkedToGps, setIsStartLinkedToGps] = useState(false);
  const [gpsStartNotice, setGpsStartNotice] = useState<{
    message: string;
    canOpenSettings?: boolean;
    offerPickOnMap?: boolean;
  } | null>(null);
  const [activeInputField, setActiveInputField] = useState<'start' | 'end' | null>(null);
  
  // Suggestion visibility
  const [showStartSuggestions, setShowStartSuggestions] = useState(false);
  const [showEndSuggestions, setShowEndSuggestions] = useState(false);
  
  // Route selection config
  const [routeProfile] = useState<'foot'>('foot');
  const [routes, setRoutes] = useState<CalculatedRoute[]>([]);
  const [routeWarning, setRouteWarning] = useState<string | null>(null);
  const [activeRouteIndex, setActiveRouteIndex] = useState<number>(0);
  const [routeCalculated, setRouteCalculated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isCheckingSaferRoutes, setIsCheckingSaferRoutes] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rawCandidatesRef = useRef<RawRouteCandidate[]>([]);
  
  // Real-time caution area warning alert (independent of route results)
  interface ActiveZoneAlert {
    zoneId: string;
    zoneTitle: string;
    category: string;
    incidentText: string;
  }
  const [activeZoneAlert, setActiveZoneAlert] = useState<ActiveZoneAlert | null>(null);
  const [dismissedZoneId, setDismissedZoneId] = useState<string | null>(null);
  const enteredZoneIdRef = useRef<string | null>(null);

  // Simulated navigation movement
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedIndex, setSimulatedIndex] = useState(0);
  const [currentLoc, setCurrentLoc] = useState<[number, number] | null>(null);
  const [proximityAlert, setProximityAlert] = useState<string | null>(null);
  const simulationTimer = useRef<NodeJS.Timeout | null>(null);

  // Simulated clock override (Strictly applied ONLY while isSimulating is TRUE)
  // Selector options: 'now' (null) | '10pm' (22) | '2pm' (14) | 'custom' (customSimHour)
  const [simClockMode, setSimClockMode] = useState<'now' | '10pm' | '2pm' | 'custom'>('now');
  const [customSimHour, setCustomSimHour] = useState<number>(20);
  const simulatedHour: number | null = isSimulating
    ? (simClockMode === '10pm' ? 22 : simClockMode === '2pm' ? 14 : simClockMode === 'custom' ? customSimHour : null)
    : null;
  const currentSimHourRef = useRef<number | null>(null);
  currentSimHourRef.current = simulatedHour;
  
  // Dynamic route analytics and safety segmentation helper (delegates to computeRouteZoneMetrics)
  const processRouteCoordinates = (
    coordinates: [number, number][], 
    distance: number,
    isSim: boolean = isSimulating,
    simHour: number | null = simulatedHour
  ) => {
    return computeRouteZoneMetrics(coordinates, distance, distance / 1.3, zones, isSim, simHour);
  };

  // Get danger zone rendering properties based strictly on active time status (Single Color Rule)
  // Feeds simulated clock strictly during simulation; real Manila time otherwise
  const getDangerZoneSpecs = (zone: DangerZone) => {
    const isNow = isZoneCurrentlyActive(zone, isSimulating, simulatedHour);
    const styles = getZoneMapStyles(zone, isNow);
    const timeText = formatActiveTimeWindow(zone);
    const statusText = isNow 
      ? 'Currently active' 
      : (zone.activeTime === 'night_only' ? 'Caution at night only (Inactive right now)' : 'Inactive right now');

    return {
      color: ZONE_COLOR,
      label: isNow ? '⚠️ CAUTION AREA' : `ℹ️ CAUTION AREA (${timeText})`,
      labelClass: isNow ? 'text-orange-700 font-bold' : 'text-slate-600 font-bold',
      statusText,
      fillOpacityGlow: styles.fillOpacityGlow,
      fillOpacityPrecision: styles.fillOpacityPrecision,
      weight: styles.weight,
      dashArray: styles.dashArray,
      isNow
    };
  };
  
  // Unified single source of truth for location tracking
  const {
    position: userLocation,
    accuracy: userAccuracy,
    heading: userHeading,
    speed: userSpeed,
    status: gpsStatus,
    isStale: isGpsStale,
    isOutsidePalanan: isUserOutsidePalanan,
    autoFollow: autoFollowGps,
    setAutoFollow: setAutoFollowGps,
    recenter: recenterGps,
    requestPermission: requestGpsPermission,
    openSettings: openGpsSettings,
    setSimulatedOverride,
    getFilteredPosition,
  } = useLocationTracker();

  // Synchronize simulator position override with location tracker
  useEffect(() => {
    if (isSimulating && currentLoc) {
      setSimulatedOverride(currentLoc);
    } else if (!isSimulating) {
      setSimulatedOverride(null);
    }
  }, [isSimulating, currentLoc, setSimulatedOverride]);

  // Keep startPoint synchronized with live position while linked to GPS before route generation
  useEffect(() => {
    if (isStartLinkedToGps && !routeCalculated && userLocation) {
      setStartPoint(userLocation);
    }
  }, [isStartLinkedToGps, routeCalculated, userLocation]);

  // Off-route detection state (user is > 50m from route start, OR > 40m from active route for >= 10 seconds)
  const [isOffRoute, setIsOffRoute] = useState(false);
  const [offRouteDistance, setOffRouteDistance] = useState<number>(0);
  const offRouteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const activeRoute = routes[activeRouteIndex];
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2 || !userLocation) {
      setIsOffRoute(false);
      offRouteTimerRef.current = null;
      return;
    }

    const distToRoute = getDistanceToRouteMeters(userLocation, activeRoute.coordinates);
    const distToStart = getDistanceMeters(
      userLocation[0],
      userLocation[1],
      activeRoute.coordinates[0][0],
      activeRoute.coordinates[0][1]
    );
    const displayDist = Math.round(Math.max(distToRoute, distToStart));
    setOffRouteDistance(displayDist);

    // Trigger recalculation prompt immediately if > 50m from trip start, or after 10s if > 40m off route
    if (distToStart > 50) {
      setIsOffRoute(true);
    } else if (distToRoute > 40) {
      if (!offRouteTimerRef.current) {
        offRouteTimerRef.current = Date.now();
      } else if (Date.now() - offRouteTimerRef.current >= 10000) {
        setIsOffRoute(true);
      }
    } else {
      offRouteTimerRef.current = null;
      setIsOffRoute(false);
    }
  }, [userLocation, routes, activeRouteIndex]);

  // Collapsible Bottom Sheet Expansion state
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);

  // User auth details
  const { user, profile, isAdmin, isDemoMode: authIsDemoMode, toggleUserRole } = useAuth();
  const isDemo = authIsDemoMode ?? checkDemoMode(user, profile);
  
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

  // Palanan boundary warning popup for manual triggers
  const [showOutsidePalananPopup, setShowOutsidePalananPopup] = useState(false);

  // Auto-dismiss toast after 4.5s
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Active approved spots for public map view and panel count badge
  const activeApprovedSpots = communitySpots.filter(isSpotVisibleOnMap);

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
        
        // Sort by useCount desc (favorites first), then by createdAt desc
        places.sort((a, b) => b.useCount - a.useCount || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setSavedPlaces(places);
        setLoadingSavedPlaces(false);
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
        setSavedPlaces([]);
      }
      setLoadingSavedPlaces(false);
    }

    return () => unsubscribe();
  }, [user]);


  // Ref hook to trigger custom map viewport action hooks
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    let rawZones1: DangerZone[] = [];
    let rawZones2: DangerZone[] = [];

    const updateMergedZones = () => {
      const mergedMap = new Map<string, DangerZone>();
      rawZones1.forEach(z => mergedMap.set(z.id, z));
      rawZones2.forEach(z => mergedMap.set(z.id, z));
      
      // Filter out any danger zones marked as resolved, inactive, needsLocation, missing/zero coords, or outside bounds
      const combined: DangerZone[] = [];
      for (const z of mergedMap.values()) {
        if (!z) continue;
        if (z.active === false) {
          console.warn(`[DangerZone] Skipped zone "${z.id}": inactive`);
          continue;
        }
        if (isZoneResolved(z)) {
          console.warn(`[DangerZone] Skipped zone "${z.id}": resolved`);
          continue;
        }
        if (z.needsLocation) {
          console.warn(`[DangerZone] Skipped zone "${z.id}": needsLocation`);
          continue;
        }
        const lat = z.location?.lat;
        const lng = z.location?.lng;
        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
          console.warn(`[DangerZone] Skipped zone "${z.id}": bad coordinates (${lat}, ${lng})`);
          continue;
        }
        if (!isInsidePalanan(lat, lng)) {
          console.warn(`[DangerZone] Skipped zone "${z.id}": out of bounds (${lat}, ${lng})`);
          continue;
        }
        combined.push(z);
      }
      setZones(combined);
    };
    
    // Realtime hazard areas
    const unsubZones1 = onSnapshot(
      collection(db, 'danger_zones'), 
      (snapshot) => {
        rawZones1 = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          const loc = safeGetCoords(data);
          if (!loc) {
            return normalizeDangerZone({ ...data, id: docSnap.id, needsLocation: true, active: false, isResolved: true });
          }
          return normalizeDangerZone({ ...data, id: docSnap.id, location: loc, latitude: loc.lat, longitude: loc.lng });
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
          if (!loc) {
            return normalizeDangerZone({ ...data, id: docSnap.id, needsLocation: true, active: false, isResolved: true });
          }
          return normalizeDangerZone({ ...data, id: docSnap.id, location: loc, latitude: loc.lat, longitude: loc.lng });
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
              // Ignore legacy generated seed spots in memory (never delete from database)
              return;
            }
            const loc = safeGetCoords(data);
            if (!loc) return;

            // In-memory deduplication by title and coordinates (never delete from database)
            const dupKey = `${title.toLowerCase()}_${loc.lat.toFixed(5)}_${loc.lng.toFixed(5)}`;
            if (seenKeys.has(dupKey)) {
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
    if (isStartLinkedToGps) {
      setStartQuery('My location');
      return;
    }
    if (startPoint && typeof startPoint[0] === 'number' && typeof startPoint[1] === 'number') {
      const match = PALANAN_PLACES.find(p => p.latLng && p.latLng[0] === startPoint[0] && p.latLng[1] === startPoint[1]);
      setStartQuery(match ? match.name : `Map Point [${startPoint[0].toFixed(4)}, ${startPoint[1].toFixed(4)}]`);
    } else {
      setStartQuery('');
    }
  }, [startPoint, isStartLinkedToGps]);

  // Default start to "My location" when destination is set and start is empty
  useEffect(() => {
    if (endPoint && !startPoint) {
      getRouteStartFromGps({ waitForFix: false }).then((res) => {
        if (res.success) {
          setStartPoint(res.point);
          setIsStartLinkedToGps(true);
          setStartQuery('My location');
          setGpsStartNotice(null);
          if (res.notice) {
            setRouteWarning(res.notice);
          }
        } else {
          setGpsStartNotice({
            message: res.message,
            canOpenSettings: res.canOpenSettings,
            offerPickOnMap: res.offerPickOnMap,
          });
        }
      });
    }
  }, [endPoint, startPoint]);

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

  // Real-time caution area warning popup check (independent of routing results)
  useEffect(() => {
    const effectivePos = isSimulating && currentLoc ? currentLoc : userLocation;
    if (!effectivePos) return;

    // Signal quality: do not fire caution popup on weak GPS fix (> 50m) when not simulating
    if (!isSimulating && (gpsStatus === 'weak' || (userAccuracy !== null && userAccuracy > 50))) {
      return;
    }

    const [lat, lng] = effectivePos;

    const activeNow = zones.filter(z =>
      z && !isZoneResolved(z) && z.active !== false && z.location &&
      typeof z.location.lat === 'number' && typeof z.location.lng === 'number' &&
      isZoneCurrentlyActive(z, isSimulating, currentSimHourRef.current)
    );

    let insideZone: DangerZone | null = null;
    for (const z of activeNow) {
      const d = getDistanceMeters(lat, lng, z.location.lat, z.location.lng);
      if (d <= z.radius) {
        insideZone = z;
        break;
      }
    }

    if (insideZone) {
      if (enteredZoneIdRef.current !== insideZone.id) {
        enteredZoneIdRef.current = insideZone.id;
        setDismissedZoneId(null);

        const totalIncidents = insideZone.crimeCount || 0;
        const period = insideZone.dataPeriod?.trim();
        const incidentText = totalIncidents > 0 && period
          ? `${totalIncidents} recorded incident${totalIncidents === 1 ? '' : 's'} (${period})`
          : totalIncidents > 0
          ? `${totalIncidents} recorded incident${totalIncidents === 1 ? '' : 's'}`
          : 'No incident count recorded';

        // Use softer wording when accuracy is between 40m and 50m
        const isBorderlineAccurate = !isSimulating && userAccuracy !== null && userAccuracy > 40 && userAccuracy <= 50;
        const baseTitle = insideZone.description || (insideZone as any).title || insideZone.locationName || 'Caution Area';
        const zoneTitle = isBorderlineAccurate
          ? `You may be near a caution area: ${baseTitle}`
          : baseTitle;

        setActiveZoneAlert({
          zoneId: insideZone.id,
          zoneTitle,
          category: insideZone.category || 'General Risk',
          incidentText
        });
        playAlertBuzzer();
      }
    } else {
      // 15 m exit buffer before re-triggering (hysteresis), or clear immediately if zone became inactive
      if (enteredZoneIdRef.current) {
        const prevZone = zones.find(z => z.id === enteredZoneIdRef.current);
        if (prevZone && prevZone.location) {
          const d = getDistanceMeters(lat, lng, prevZone.location.lat, prevZone.location.lng);
          const isStillActive = isZoneCurrentlyActive(prevZone, isSimulating, currentSimHourRef.current);
          if (d > prevZone.radius + 15 || !isStillActive) {
            enteredZoneIdRef.current = null;
            setDismissedZoneId(null);
            setActiveZoneAlert(null);
          }
        } else {
          enteredZoneIdRef.current = null;
          setDismissedZoneId(null);
          setActiveZoneAlert(null);
        }
      }
    }
  }, [currentLoc, userLocation, isSimulating, zones, gpsStatus, userAccuracy, clockTick, simulatedHour]);

  // Demo trip query parameter (?demo=true) and custom event listener
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('demo') === 'true' || params.get('demo') === '1') {
        loadDemoRoute();
      }

      const handleDemoEvent = () => loadDemoRoute();
      window.addEventListener('load-demo-trip', handleDemoEvent);
      return () => window.removeEventListener('load-demo-trip', handleDemoEvent);
    }
  }, [zones]);




  // Hidden demo-trip loader (Fixed Palanan trip: [14.55915, 120.99920] to [14.55565, 120.99920])
  const loadDemoRoute = () => {
    const demoStart: [number, number] = [14.55915, 120.99920];
    const demoEnd: [number, number] = [14.55565, 120.99920];
    setStartPoint(demoStart);
    setStartQuery('Demo Origin [14.55915, 120.99920]');
    setEndPoint(demoEnd);
    setEndQuery('Demo Destination [14.55565, 120.99920]');
    setErrorMessage(null);
    setRouteWarning(null);

    const demoRes = getDemoTripSavedRoutes(zones, isSimulating, currentSimHourRef.current);
    rawCandidatesRef.current = demoRes.rawCandidates || [];
    setRoutes(demoRes.routes);
    setRouteWarning(demoRes.statusMessage || null);
    setActiveRouteIndex(0);
    setRouteCalculated(true);
    setIsSheetExpanded(true);
  };

  // Perform road snapped calculations
  const calculateSafeDirections = async (currentStart = startPoint, currentEnd = endPoint) => {
    if (!currentStart || !currentEnd) {
      setErrorMessage("Please set both a Start Location and a Destination inside Palanan.");
      return;
    }

    setLoading(true);
    setIsCheckingSaferRoutes(true);
    setErrorMessage(null);
    setRouteWarning(null);
    setProximityAlert(null);
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);

    const onProgress = (partial: any) => {
      if (partial.routes && partial.routes.length > 0) {
        setRoutes(partial.routes);
        setRouteCalculated(true);
        setIsSheetExpanded(true);
        setActiveRouteIndex(prev => (prev < partial.routes.length ? prev : 0));
      }
      if (partial.statusMessage) {
        setRouteWarning(partial.statusMessage);
      }
    };

    try {
      const result = await generateSuggestedRoutes(
        currentStart,
        currentEnd,
        zones,
        isSimulating,
        currentSimHourRef.current,
        undefined,
        onProgress,
        { isCurrentLocation: isStartLinkedToGps }
      );

      rawCandidatesRef.current = result.rawCandidates || [];

      if (!result.routes || result.routes.length === 0) {
        throw new Error("No network road path available between selected points.");
      }

      setRoutes(result.routes);
      setRouteWarning(result.statusMessage || result.warning || null);
      setActiveRouteIndex(prev => (prev < result.routes.length ? prev : 0));
      setRouteCalculated(true);
      setIsSheetExpanded(true);
    } catch (err: any) {
      console.warn("Unable to fetch routing from service:", err);
      const isDemoCoords =
        Math.abs(currentStart[0] - 14.55915) < 0.001 &&
        Math.abs(currentStart[1] - 120.99920) < 0.001 &&
        Math.abs(currentEnd[0] - 14.55565) < 0.001 &&
        Math.abs(currentEnd[1] - 120.99920) < 0.001;

      if (isDemoCoords) {
        const demoRes = getDemoTripSavedRoutes(zones, isSimulating, currentSimHourRef.current);
        setRoutes(demoRes.routes);
        setRouteWarning(demoRes.statusMessage || null);
        setActiveRouteIndex(0);
        setRouteCalculated(true);
        setIsSheetExpanded(true);
      } else {
        setErrorMessage("Couldn't get a walking route. Check your connection and try again.");
        setRoutes(prevRoutes => (prevRoutes && prevRoutes.length > 0 ? prevRoutes : []));
      }
    } finally {
      setLoading(false);
      setIsCheckingSaferRoutes(false);
    }
  };

  // Retry button handler: resumes only the unfinished safer route search and keeps shown routes
  const handleRetrySaferSearch = async () => {
    if (!startPoint || !endPoint || isCheckingSaferRoutes) return;
    setIsCheckingSaferRoutes(true);
    setErrorMessage(null);
    setRouteWarning(null);

    const onProgress = (partial: any) => {
      if (partial.routes && partial.routes.length > 0) {
        setRoutes(partial.routes);
        setRouteCalculated(true);
        setIsSheetExpanded(true);
        setActiveRouteIndex(prev => (prev < partial.routes.length ? prev : 0));
      }
      if (partial.statusMessage) {
        setRouteWarning(partial.statusMessage);
      }
    };

    try {
      const result = await generateSuggestedRoutes(
        startPoint,
        endPoint,
        zones,
        isSimulating,
        currentSimHourRef.current,
        undefined,
        onProgress,
        { forceRetry: true }
      );
      if (result.routes && result.routes.length > 0) {
        setRoutes(result.routes);
      }
      setRouteWarning(result.statusMessage || result.warning || null);
    } catch (err: any) {
      console.warn("Retry failed:", err);
    } finally {
      setIsCheckingSaferRoutes(false);
    }
  };

  // Map Tap Interaction Helper
  const handleMapSelection = (latLng: [number, number]) => {
    if (isSimulating) return;

    if (isPickingSpotOnMap) {
      if (!isInsidePalanan(latLng[0], latLng[1])) {
        setToastMessage('⚠️ Location is outside Barangay Palanan. Please pinpoint a location within the barangay boundaries.');
        return;
      }
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
      setIsStartLinkedToGps(false);
      setGpsStartNotice(null);
      setActiveInputField('end'); // Auto-advance to destination selection
    } else {
      setEndPoint(latLng);
      setActiveInputField(null);
    }
  };

  // Quick Navigation: tap saved place -> automatically generate safe route from current location
  const selectSavedPlaceCommute = async (place: SavedPlace) => {
    if (!place || !place.location || typeof place.location.lat !== 'number' || typeof place.location.lng !== 'number') {
      console.warn("Cannot commute to place without valid location coordinates.");
      return;
    }
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);
    setCurrentLoc(null);
    setProximityAlert(null);
    setGpsStartNotice(null);

    const endCoords: [number, number] = [place.location.lat, place.location.lng];
    setEndPoint(endCoords);
    setEndQuery(place.name);

    let currentStart = startPoint;
    if (!currentStart || isStartLinkedToGps) {
      const res = await getRouteStartFromGps({
        waitForFix: true,
        timeoutMs: 10000,
        onStatus: (msg) => {
          setRouteWarning(msg);
          setToastMessage(msg);
        }
      });
      if (res.success) {
        currentStart = res.point;
        setStartPoint(res.point);
        setIsStartLinkedToGps(true);
        setStartQuery('My location');
        if (res.notice) {
          setRouteWarning(res.notice);
          setToastMessage(res.notice);
        }
      } else {
        setErrorMessage(res.message);
        setToastMessage(res.message);
        setGpsStartNotice({
          message: res.message,
          canOpenSettings: res.canOpenSettings,
          offerPickOnMap: res.offerPickOnMap,
        });
        return;
      }
    }

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

    if (currentStart) {
      calculateSafeDirections(currentStart, endCoords);
    }
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

      // In Demo Mode (Guest), the upvote is reflected locally in React state for demo, but database is not modified
      if (isDemo) {
        return;
      }

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

  const selectSpotDestination = async (spot: CommunitySpot) => {
    if (!spot || !spot.location) return;
    const coords: [number, number] = [spot.location.lat, spot.location.lng];
    setEndPoint(coords);
    setEndQuery(spot.title);
    setIsSheetExpanded(true);
    setGpsStartNotice(null);

    let currentStart = startPoint;
    if (!currentStart || isStartLinkedToGps) {
      const res = await getRouteStartFromGps({
        waitForFix: true,
        timeoutMs: 10000,
        onStatus: (msg) => {
          setRouteWarning(msg);
          setToastMessage(msg);
        }
      });
      if (res.success) {
        currentStart = res.point;
        setStartPoint(res.point);
        setIsStartLinkedToGps(true);
        setStartQuery('My location');
        if (res.notice) {
          setRouteWarning(res.notice);
          setToastMessage(res.notice);
        }
      } else {
        setErrorMessage(res.message);
        setToastMessage(res.message);
        setGpsStartNotice({
          message: res.message,
          canOpenSettings: res.canOpenSettings,
          offerPickOnMap: res.offerPickOnMap,
        });
        return;
      }
    }

    if (currentStart) {
      calculateSafeDirections(currentStart, coords);
    }
  };

  const handleCreateCommunitySpot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spotTitle.trim() || !spotCoords) return;

    // Validate pinned location coordinates against Palanan boundary
    if (!isInsidePalanan(spotCoords[0], spotCoords[1])) {
      setToastMessage('⚠️ Spot location is outside Barangay Palanan. Please select a spot within barangay boundaries.');
      return;
    }

    // If user's GPS accuracy is weak (> 50m), ask them to wait for a stronger fix instead of rejecting as outside Palanan
    if (userAccuracy && userAccuracy > 50) {
      setToastMessage(`⚠️ GPS accuracy is currently low (±${Math.round(userAccuracy)}m). Please wait a moment for a stronger GPS fix before pinning a spot.`);
      return;
    }

    // Validate real-time user GPS position when available
    if (userLocation && !isInsidePalanan(userLocation[0], userLocation[1])) {
      setToastMessage('⚠️ You are currently outside Barangay Palanan. Community spots can only be submitted within Palanan.');
      return;
    }

    if (isDemo) {
      setToastMessage('⚠️ Demo Mode: Adding community spots is disabled to prevent test data creation.');
      setIsAddSpotModalOpen(false);
      return;
    }

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
        approvedByAdmin: false,
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
      const granted = await requestGpsPermission();
      if (!granted) {
        setToastMessage("⚠️ Location permission is required to detect your location.");
        return;
      }

      const pos = await getFilteredPosition();
      const gpsCoords: [number, number] = pos.coords;

      if (mapRef.current) {
        mapRef.current.setView(gpsCoords, 17, { animate: true });
      }
      if (!startPoint) {
        setStartPoint(gpsCoords);
      }
      if (endPoint) {
        calculateSafeDirections(gpsCoords, endPoint);
      }

      if (pos.isOutsidePalanan) {
        setShowOutsidePalananPopup(true);
        setToastMessage("⚠️ You are outside Barangay Palanan.");
      } else {
        setShowOutsidePalananPopup(false);
        if (pos.accuracy > 50) {
          setToastMessage(`⚠️ GPS Located with weak signal (±${Math.round(pos.accuracy)}m).`);
        } else {
          setToastMessage(`📍 GPS Located! Precision: ±${Math.round(pos.accuracy)}m`);
        }
      }
    } catch (err) {
      console.warn("GPS lookup error:", err);
      setToastMessage("⚠️ Unable to acquire GPS lock. Please check your device location settings.");
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

  // Reset simulation clock override
  const resetSimulationClock = () => {
    setSimClockMode('now');
    setCustomSimHour(20);
    currentSimHourRef.current = null;
  };

  // Recompute route scoring and in-zone heatmap segments when clock override changes or resets
  const recomputeRoutesWithClock = (isSim: boolean, simHour: number | null) => {
    const currentRoute = routes[activeRouteIndex];
    const currentRouteId = currentRoute?.id;
    const currentRouteName = currentRoute?.name;

    if (rawCandidatesRef.current && rawCandidatesRef.current.length > 0 && startPoint && endPoint) {
      const result = processRoutePipeline({
        candidates: rawCandidatesRef.current,
        start: startPoint,
        end: endPoint,
        zones,
        isSim,
        simHour
      });
      setRoutes(result.routes);
      setRouteWarning(result.statusMessage || result.warning || null);
      if (result.routes.length > 0) {
        const matchIdx = result.routes.findIndex(r => r.id === currentRouteId || r.name === currentRouteName);
        if (matchIdx >= 0) {
          setActiveRouteIndex(matchIdx);
        }
      }
    } else {
      setRoutes(prevRoutes => {
        if (!prevRoutes || prevRoutes.length === 0) return prevRoutes;
        if (!startPoint || !endPoint) return prevRoutes;
        const rawFromPrev: RawRouteCandidate[] = prevRoutes.map(r => ({
          coordinates: r.coordinates,
          distance: r.distance,
          duration: r.duration,
          steps: r.steps
        }));
        const result = processRoutePipeline({
          candidates: rawFromPrev,
          start: startPoint,
          end: endPoint,
          zones,
          isSim,
          simHour
        });
        setRouteWarning(result.statusMessage || result.warning || null);
        return result.routes;
      });
    }
  };

  // Handler for changing simulated clock mid-simulation
  const handleClockModeChange = (mode: 'now' | '10pm' | '2pm' | 'custom', customVal?: number) => {
    setSimClockMode(mode);
    const targetCustom = customVal !== undefined ? customVal : customSimHour;
    if (customVal !== undefined) setCustomSimHour(customVal);

    const newSimHour: number | null = mode === '10pm' ? 22 : mode === '2pm' ? 14 : mode === 'custom' ? targetCustom : null;
    currentSimHourRef.current = newSimHour;

    // Immediately re-scan radar proximity for currentLoc if active
    if (currentLoc) {
      let activeDangerMsg: string | null = null;
      zones.forEach(zone => {
        if (!zone || isZoneResolved(zone) || zone.active === false || !zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return;
        if (!isZoneCurrentlyActive(zone, true, newSimHour)) return;
        const d = getDistanceMeters(currentLoc[0], currentLoc[1], zone.location.lat, zone.location.lng);
        if (d <= zone.radius) {
          activeDangerMsg = `PROXIMITY WARNING: Inside active ${ZONE_LABEL.toLowerCase()}: "${zone.description}".`;
        } else if (d <= zone.radius * 1.5 && !activeDangerMsg) {
          activeDangerMsg = `AWARENESS: Nearing active ${ZONE_LABEL.toLowerCase()}: "${zone.description}" within ${Math.round(d)}m.`;
        }
      });
      setProximityAlert(activeDangerMsg);
      if (activeDangerMsg) playAlertBuzzer();
    }

    // Immediately recompute route safety & segments with the new simulated clock
    recomputeRoutesWithClock(true, newSimHour);
  };

  // Simulating active GPS path
  const startSimulation = (targetIndex?: number | any) => {
    const numericIndex = typeof targetIndex === 'number' ? targetIndex : activeRouteIndex;
    const targetRoute = routes[numericIndex] || routes[activeRouteIndex] || routes[0];
    if (!targetRoute) {
      if (startPoint && endPoint) {
        calculateSafeDirections(startPoint, endPoint).then(() => {
          setIsSimulating(true);
        });
        return;
      }
      setErrorMessage("Please set both a Start Location and Destination to simulate walking.");
      return;
    }
    const resolvedIndex = routes.indexOf(targetRoute) >= 0 ? routes.indexOf(targetRoute) : numericIndex;
    setActiveRouteIndex(resolvedIndex);
    setIsSimulating(true);
    setSimulatedIndex(0);
    const coords = targetRoute.coordinates;
    if (!coords || coords.length === 0) return;
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
          if (simClockMode !== 'now') {
            resetSimulationClock();
            recomputeRoutesWithClock(false, null);
          }
          return coords.length - 1;
        }

        const point = coords[nextIdx];
        setCurrentLoc(point);

        // Scan radar alert proximity limits using active simulated clock override
        let activeDangerMsg: string | null = null;
        zones.forEach(zone => {
          if (!zone || isZoneResolved(zone) || zone.active === false || !zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return;
          if (!isZoneCurrentlyActive(zone, true, currentSimHourRef.current)) return; // Strictly feeds simulated clock!
          const d = getDistanceMeters(point[0], point[1], zone.location.lat, zone.location.lng);
          if (d <= zone.radius) {
            activeDangerMsg = `PROXIMITY WARNING: Inside active ${ZONE_LABEL.toLowerCase()}: "${zone.description}".`;
          } else if (d <= zone.radius * 1.5 && !activeDangerMsg) {
            activeDangerMsg = `AWARENESS: Nearing active ${ZONE_LABEL.toLowerCase()}: "${zone.description}" within ${Math.round(d)}m.`;
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

  // Switch selected route and keep simulator running if active
  const selectRoute = (idx: number) => {
    setActiveRouteIndex(idx);
    if (isSimulating) {
      startSimulation(idx);
    }
  };

  const stopSimulation = () => {
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);
    setCurrentLoc(null);
    setProximityAlert(null);
    if (simClockMode !== 'now') {
      resetSimulationClock();
      recomputeRoutesWithClock(false, null);
    }
  };

  // Ensure override resets on page unmount and app close (beforeunload)
  useEffect(() => {
    const handleBeforeUnload = () => {
      resetSimulationClock();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      if (simulationTimer.current) clearInterval(simulationTimer.current);
      resetSimulationClock();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

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

  const handleClearStartPoint = async () => {
    setRouteCalculated(false);
    setRoutes([]);
    setIsSimulating(false);
    if (simulationTimer.current) clearInterval(simulationTimer.current);
    setCurrentLoc(null);
    setProximityAlert(null);
    setGpsStartNotice(null);

    // Clearing the field returns to "My location"
    const res = await getRouteStartFromGps({ waitForFix: false });
    if (res.success) {
      setStartPoint(res.point);
      setIsStartLinkedToGps(true);
      setStartQuery('My location');
    } else {
      setStartPoint(null);
      setStartQuery('');
      setIsStartLinkedToGps(false);
      setGpsStartNotice({
        message: res.message,
        canOpenSettings: res.canOpenSettings,
        offerPickOnMap: res.offerPickOnMap,
      });
    }
  };

  const handleUseGpsForStart = async () => {
    setGpsStartNotice(null);
    const res = await getRouteStartFromGps({
      waitForFix: true,
      timeoutMs: 10000,
      onStatus: (msg) => {
        setRouteWarning(msg);
        setToastMessage(msg);
      }
    });

    if (res.success) {
      setStartPoint(res.point);
      setIsStartLinkedToGps(true);
      setStartQuery('My location');
      setErrorMessage(null);
      setGpsStartNotice(null);
      if (res.notice) {
        setToastMessage(res.notice);
        setRouteWarning(res.notice);
      }
    } else {
      setErrorMessage(res.message);
      setToastMessage(res.message);
      setGpsStartNotice({
        message: res.message,
        canOpenSettings: res.canOpenSettings,
        offerPickOnMap: res.offerPickOnMap,
      });
    }
  };

  const handleRecalculateFromHere = async () => {
    setIsOffRoute(false);
    const res = await getRouteStartFromGps({
      waitForFix: true,
      timeoutMs: 10000,
      onStatus: (msg) => {
        setRouteWarning(msg);
        setToastMessage(msg);
      }
    });
    if (res.success && endPoint) {
      setStartPoint(res.point);
      setIsStartLinkedToGps(true);
      setStartQuery('My location');
      if (res.notice) {
        setRouteWarning(res.notice);
        setToastMessage(res.notice);
      }
      calculateSafeDirections(res.point, endPoint);
    } else if (!res.success) {
      setToastMessage(res.message);
      setGpsStartNotice({
        message: res.message,
        canOpenSettings: res.canOpenSettings,
        offerPickOnMap: res.offerPickOnMap,
      });
    }
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

  const [showRouteDebug, setShowRouteDebug] = useState<boolean>(true);
  const showHeatmapSelfTest = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).has('testHeatmap') ||
    (window as any).__SAFE_ROUTE_TEST_HEATMAP === true
  );

  // Active zones right now (accounting for simulation clock if active)
  const activeNowZones = React.useMemo(() => {
    return (zones || []).filter(z => {
      if (!z || isZoneResolved(z) || z.active === false) return false;
      if (!z.location || typeof z.location.lat !== 'number' || typeof z.location.lng !== 'number') return false;
      return isZoneCurrentlyActive(z, isSimulating, currentSimHourRef.current);
    });
  }, [zones, isSimulating, simulatedHour]);

  // Compute in-zone segments at render time directly from displayed route coordinates (densified to 10m)
  // and active zones, merging consecutive in-zone points into a single polyline per zone entry.
  const activeInZoneSegments: InZonePolylineSegment[] = React.useMemo(() => {
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) return [];
    return computeInZonePolylinesAtRenderTime(activeRoute.coordinates, activeNowZones);
  }, [activeRoute, activeNowZones]);

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
          <MapPanesSetup />
          
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
            liveCoords={userLocation} 
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
                  pane="dangerZonesPane"
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
                  pane="dangerZonesPane"
                  pathOptions={{ 
                    fillColor: specs.color, 
                    fillOpacity: specs.fillOpacityPrecision, 
                    color: specs.color, 
                    weight: specs.weight,
                    dashArray: specs.dashArray
                  }} 
                >
                  <Popup>
                    <div id={`danger-zone-popup-${zone.id}`} className="text-xs p-1.5 min-w-[210px] max-w-[270px]">
                      {/* Top Header Badge */}
                      <div className="flex items-center justify-between gap-1.5 mb-1.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${specs.labelClass} bg-orange-50 border border-orange-200`}>
                          {specs.label}
                        </span>
                      </div>

                      {/* Name / Location Name */}
                      {zone.name && (
                        <h4 className="font-bold text-slate-900 text-sm mb-0.5">
                          {escapeHtml(zone.name)}
                        </h4>
                      )}

                      {/* Category - plain text */}
                      {zone.category && (
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                          Category: {escapeHtml(zone.category)}
                        </div>
                      )}

                      {/* Status stated in words */}
                      <div className="text-xs text-slate-700 font-medium mb-1.5 flex items-center gap-1.5">
                        <span className="text-slate-400 text-[11px]">Status:</span>
                        <span className="font-bold text-slate-900">{specs.statusText}</span>
                      </div>

                      {/* Description */}
                      <p className="text-xs text-slate-700 leading-snug mb-2 font-medium">
                        {escapeHtml(zone.description)}
                      </p>

                      {/* Inactive notice if not currently active */}
                      {!specs.isNow && (
                        <div className="bg-slate-50 text-slate-700 text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-200 mb-2">
                          🌙 {formatActiveTimeWindow(zone)} — Currently inactive
                        </div>
                      )}

                      {/* Data Contract Info Block */}
                      <div className="space-y-1 pt-1.5 border-t border-slate-100 text-[11px]">
                        {/* Source */}
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-slate-400 text-[10px]">Source:</span>
                          <span className="font-semibold text-slate-700 text-right">
                            {escapeHtml(getSourceLabel(zone.source))}
                          </span>
                        </div>

                        {/* Incident Count */}
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-slate-400 text-[10px]">Incidents:</span>
                          <span className="font-semibold text-slate-700 text-right">
                            {escapeHtml(formatIncidentCountText(zone))}
                          </span>
                        </div>

                        {/* Active Time Window */}
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-slate-400 text-[10px]">Active Window:</span>
                          <span className="font-semibold text-slate-700 text-right">
                            {escapeHtml(formatActiveTimeWindow(zone))}
                          </span>
                        </div>

                        {/* Crime Types Breakdown */}
                        {zone.crimeTypes && Object.keys(zone.crimeTypes).length > 0 && (
                          <div className="pt-1 mt-1 border-t border-slate-100">
                            <span className="text-slate-400 text-[10px] block mb-1">Incident Types:</span>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(zone.crimeTypes).map(([type, c]) => (
                                <span key={type} className="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-medium">
                                  {escapeHtml(type)}: {escapeHtml(String(c))}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <p className="text-[9px] text-slate-400 mt-2">Monitoring perimeter: {zone.radius}m</p>
                    </div>
                  </Popup>
                </Circle>
              </React.Fragment>
            );
          })}

          {/* Community Spots Pinpoint Markers (Approved) */}
          {showCommunitySpots && communitySpots
            .filter(isSpotVisibleOnMap)
            .filter(spot => selectedSpotCategory === 'all' || spot.category === selectedSpotCategory)
            .map((spot) => {
              const isSelected = selectedCommunitySpot?.id === spot.id;
              return (
                <Marker
                  key={`spot-${spot.id}`}
                  position={[spot.location.lat, spot.location.lng]}
                  icon={createCommunitySpotIcon(spot.category, isSelected, false)}
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

          {/* Community Spots Author-Only Pending Preview (Dashed border, 'Under review' badge) */}
          {showCommunitySpots && communitySpots
            .filter(spot => isSpotAuthorPending(spot, user?.uid))
            .filter(spot => selectedSpotCategory === 'all' || spot.category === selectedSpotCategory)
            .map((spot) => {
              const isSelected = selectedCommunitySpot?.id === spot.id;
              return (
                <Marker
                  key={`pending-spot-${spot.id}`}
                  position={[spot.location.lat, spot.location.lng]}
                  icon={createCommunitySpotIcon(spot.category, isSelected, true)}
                  eventHandlers={{
                    click: () => setSelectedCommunitySpot(spot)
                  }}
                >
                  <Popup>
                    <div className="p-2 min-w-[210px] max-w-[260px] text-xs font-sans">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-100 border border-amber-300">
                          {getSpotCategoryIcon(spot.category)} {getSpotCategoryLabel(spot.category)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold text-amber-800 bg-amber-50 border border-dashed border-amber-300">
                          ⏳ Under review
                        </span>
                      </div>
                      
                      <h4 className="font-black text-slate-900 text-sm leading-snug mb-1">{spot.title}</h4>
                      <p className="text-slate-600 text-xs mb-2 leading-relaxed">{spot.description}</p>
                      
                      <div className="p-1.5 mb-2 rounded bg-amber-50 border border-amber-200 text-[10px] text-amber-900 leading-tight">
                        📢 <strong>Author Preview:</strong> Only you can see this spot on your map while awaiting Barangay Palanan approval.
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                        <span>Submitted by You</span>
                        <span className="font-semibold text-amber-600">Pending Review</span>
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

          {/* Exactly ONE User Location Marker (Google Maps style) */}
          {userLocation && (
            <UserLocationMarker
              position={userLocation}
              accuracy={userAccuracy}
              heading={userHeading}
              speed={userSpeed}
              status={gpsStatus}
              isStale={isGpsStale}
              isOutsidePalanan={isUserOutsidePalanan}
              isSimulating={isSimulating}
              autoFollow={autoFollowGps}
              onToggleAutoFollow={() => setAutoFollowGps(!autoFollowGps)}
            />
          )}

          {/* Drawn routing paths on streets */}
          {routeCalculated && startPoint && endPoint && (
            <>
              {/* 1. Unselected routes rendered first (subtle dashed line, no wide light-blue halo) */}
              {routes.map((r, idx) => {
                if (idx === activeRouteIndex) return null;
                return (
                  <Polyline 
                    key={`polyline-unselected-${idx}`}
                    positions={r.coordinates}
                    pane="routeUnderlayPane"
                    eventHandlers={{ 
                      click: () => selectRoute(idx)
                    }}
                    pathOptions={{
                      color: '#94a3b8',
                      weight: 3.5,
                      dashArray: '6, 8',
                      opacity: 0.55,
                      lineCap: 'round',
                      lineJoin: 'round'
                    }}
                  />
                );
              })}

              {/* 2. Selected route rendered on top with vibrant contrast */}
              {routes[activeRouteIndex] && (() => {
                const r = routes[activeRouteIndex];
                const idx = activeRouteIndex;
                return (
                  <React.Fragment key={`polyline-active-${idx}-${r.id}`}>
                    {/* 1. Underlying clean green route along full coordinates */}
                    <Polyline 
                      positions={r.coordinates}
                      pane="routeUnderlayPane"
                      pathOptions={{
                        pane: 'routeUnderlayPane',
                        color: '#10B981',
                        weight: 5,
                        opacity: 1.0,
                        lineCap: 'round',
                        lineJoin: 'round'
                      }}
                    />
                  </React.Fragment>
                );
              })()}
            </>
          )}

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

          {/* LAST CHILDREN OF THE MAP: Heatmap in-zone segments rendered strictly on top with higher zIndex (620) */}
          {routeCalculated && activeRoute && (
            <React.Fragment key={`heatmap-layer-${activeRouteIndex}-${activeRoute.id}`}>
              {activeInZoneSegments.map((seg, sIdx) => {
                return (
                  <Polyline 
                    key={`seg-inzone-heatmap-${activeRouteIndex}-${activeRoute.id}-${sIdx}-${seg.coordinates.length}`}
                    positions={seg.coordinates}
                    pane="inZoneHeatmapPane"
                    pathOptions={{
                      pane: 'inZoneHeatmapPane',
                      color: ZONE_COLOR,
                      weight: 8,
                      opacity: 1.0,
                      lineCap: 'round',
                      lineJoin: 'round',
                      interactive: false
                    }}
                  />
                );
              })}
            </React.Fragment>
          )}

          {/* Hidden self-test polyline (behind flag) that draws fixed orange polyline in inZoneHeatmapPane */}
          {showHeatmapSelfTest && (
            <Polyline 
              key="heatmap-selftest-fixed-dian"
              positions={[[14.55700, 120.99920], [14.55780, 120.99920]]}
              pane="inZoneHeatmapPane"
              pathOptions={{
                pane: 'inZoneHeatmapPane',
                color: ZONE_COLOR,
                weight: 8,
                opacity: 1.0,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false
              }}
            />
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



        {/* Top Controls: Community Spots and GPS Status Chip side-by-side */}
        <div className="absolute top-2.5 left-2.5 right-2.5 z-[990] flex items-start justify-between gap-1.5 pointer-events-none">
          {/* Community Spots Pinpoint Control Bar & Legend */}
          <div id="community-spots-map-control" className={`rounded-xl shadow-lg border p-1.5 sm:p-2 max-w-[210px] sm:max-w-xs transition-colors duration-300 pointer-events-auto shrink ${
            darkMode ? 'bg-slate-900/95 border-slate-800 text-white' : 'bg-white/95 backdrop-blur border-slate-200 text-slate-800'
          }`}>
            <div className="flex items-center justify-between gap-1 pb-1 border-b border-slate-100 mb-1">
              <button
                type="button"
                onClick={() => setShowCommunitySpots(!showCommunitySpots)}
                className="flex items-center gap-1 text-[11px] font-black tracking-tight text-slate-800 hover:text-emerald-600 transition"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span>🌟 <span className="hidden sm:inline">COMMUNITY </span>SPOTS</span>
                <span className="bg-emerald-100 text-emerald-800 text-[9px] px-1 py-0.2 rounded-full font-bold">
                  {activeApprovedSpots.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (userAccuracy && userAccuracy > 50) {
                    setToastMessage(`⚠️ GPS accuracy is currently low (±${Math.round(userAccuracy)}m). Please wait a moment for a stronger GPS fix before pinning a spot.`);
                    return;
                  }
                  if (userLocation && !isInsidePalanan(userLocation[0], userLocation[1])) {
                    setToastMessage('⚠️ You are currently outside Barangay Palanan. Community spots can only be submitted within Palanan.');
                    return;
                  }
                  setIsAddSpotModalOpen(false);
                  setIsPickingSpotOnMap(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[9px] font-bold py-0.5 px-2 rounded-full flex items-center gap-0.5 shadow-xs transition-all cursor-pointer shrink-0 whitespace-nowrap"
              >
                <Plus className="w-2.5 h-2.5" /> Pin
              </button>
            </div>

            {showCommunitySpots && (
              <div className="flex flex-wrap gap-0.5 sm:gap-1">
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
                    className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold flex items-center gap-0.5 transition-all ${
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

          {/* Real-Time GPS Status Chip & Recenter Badge placed beside Community Spots */}
          <div className="shrink-0 pointer-events-auto ml-auto">
            <GpsStatusChip
              status={gpsStatus}
              isStale={isGpsStale}
              accuracy={userAccuracy}
              autoFollow={autoFollowGps}
              onRecenter={() => recenterGps(mapRef.current)}
              onRequestPermission={requestGpsPermission}
              onOpenSettings={openGpsSettings}
            />
          </div>
        </div>

        {/* Off-Route Alert Notice with 10s persistence threshold */}
        {isOffRoute && userLocation && endPoint && (
          <div className="absolute top-16 left-4 right-4 z-[1050] bg-amber-500 text-white p-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 animate-fade-in border border-amber-400">
            <div className="flex items-center gap-2 text-xs font-bold text-left">
              <AlertCircle className="w-5 h-5 shrink-0 text-white" />
              <div>
                <p className="font-extrabold leading-tight">You are off the selected route</p>
                <p className="text-[10px] font-medium opacity-90">{offRouteDistance}m from planned route</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRecalculateFromHere}
              className="px-3 py-1.5 rounded-xl bg-white text-amber-700 text-xs font-black shadow-sm hover:bg-amber-50 active:scale-95 transition shrink-0 cursor-pointer"
            >
              Recalculate from here
            </button>
          </div>
        )}

        {/* Floating current location + Map controls directly on bottom-right of map */}
        <FloatingMapControls 
          onRecenter={() => recenterGps(mapRef.current)}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          autoFollow={autoFollowGps}
          hasLiveGps={!!userLocation}
          isOutsidePalanan={isUserOutsidePalanan}
        />

        {/* Circles Risk Legend to sync with Admin Portal */}
        <div id="danger-zones-circles-legend" className={`absolute bottom-4 right-4 z-[999] rounded-2xl shadow-xl border p-3.5 w-40 text-left transition-colors duration-300 ${
          darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-800'
        }`}>
          <h4 className={`text-[10px] font-black tracking-wider uppercase mb-1.5 pb-1 border-b ${
            darkMode ? 'text-slate-300 border-slate-800' : 'text-slate-800 border-slate-150'
          }`}>
            MAP LEGEND
          </h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs border border-white" style={{ backgroundColor: ZONE_COLOR }} />
              <span className={`text-[11px] font-bold ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>Caution Area</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full shrink-0 border-2 border-dashed" style={{ borderColor: ZONE_COLOR, backgroundColor: 'transparent' }} />
              <span className={`text-[11px] font-bold ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Inactive right now</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#10B981' }} />
              <span className={`text-[11px] font-bold ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>Clear</span>
            </div>
            <div className="flex items-center gap-2 pt-0.5 border-t border-slate-100">
              <span className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs border-2 border-white" style={{ backgroundColor: '#4285F4' }} />
              <span className={`text-[11px] font-bold ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>Your Location</span>
            </div>
          </div>
        </div>

        {/* Floating Out-of-Palanan Warning Popup like in Report page */}
        <AnimatePresence>
          {showOutsidePalananPopup && (
            <motion.div 
              initial={{ y: -60, opacity: 0, scale: 0.95 }} 
              animate={{ y: 0, opacity: 1, scale: 1 }} 
              exit={{ y: -60, opacity: 0, scale: 0.95 }} 
              className="absolute top-4 left-4 right-4 z-[1020]"
            >
              <div className="bg-red-600/95 backdrop-blur-md text-white p-4 rounded-3xl shadow-2xl flex items-start gap-3 border-2 border-red-400">
                <AlertCircle className="w-6 h-6 shrink-0 mt-0.5 text-white animate-pulse" />
                <div className="flex-1 text-left space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-red-200">
                      Location Warning
                    </span>
                    <span className="text-[9px] bg-white/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      Outside Palanan
                    </span>
                  </div>
                  <h4 className="text-sm font-black leading-tight text-white">
                    You are outside Barangay Palanan.
                  </h4>
                  <p className="text-xs font-semibold text-red-100/95 leading-relaxed">
                    Your real-time GPS location is currently outside Barangay Palanan boundaries. SafeRoute Lite hazard warnings and route safety guidance are centered on Palanan.
                  </p>
                </div>
                <button 
                  onClick={() => setShowOutsidePalananPopup(false)}
                  className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white shrink-0 transition cursor-pointer"
                  title="Close notice"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Simulated Time Override Badge (visible while isSimulating && simulatedHour !== null) */}
        <AnimatePresence>
          {isSimulating && simulatedHour !== null && (
            <motion.div
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -30, opacity: 0 }}
              className="absolute top-16 right-4 z-[1015]"
            >
              <div id="simulated-time-badge" className="bg-amber-500 text-slate-950 font-black text-xs px-3.5 py-1.5 rounded-full shadow-xl border-2 border-white flex items-center gap-1.5 animate-pulse">
                <Clock className="w-3.5 h-3.5" />
                <span>Simulated time: {String(Math.floor(simulatedHour)).padStart(2, '0')}:{String(Math.round((simulatedHour % 1) * 60)).padStart(2, '0')}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Real-time Caution Area Warning Popup */}
        <AnimatePresence>
          {activeZoneAlert && dismissedZoneId !== activeZoneAlert.zoneId && (
            <motion.div 
              initial={{ y: -60, opacity: 0, scale: 0.95 }} 
              animate={{ y: 0, opacity: 1, scale: 1 }} 
              exit={{ y: -60, opacity: 0, scale: 0.95 }} 
              className="absolute top-4 left-4 right-4 z-[1010]"
            >
              <div className="bg-[#EA580C] text-white p-3.5 rounded-2xl shadow-2xl flex items-start justify-between gap-3 border-2 border-orange-300">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 animate-bounce text-amber-200" />
                  <div className="text-left">
                    <h4 className="text-[10px] uppercase font-black tracking-wider leading-none mb-1 text-amber-200">
                      CAUTION AREA DETECTED
                    </h4>
                    <p className="text-xs font-black leading-tight text-white mb-0.5">
                      {activeZoneAlert.zoneTitle}
                    </p>
                    <p className="text-xs font-extrabold text-orange-100">
                      You are inside a caution area
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5 text-[10px] font-semibold text-orange-100">
                      <span className="bg-orange-700/80 px-2 py-0.5 rounded-md border border-orange-400/40">
                        Category: {activeZoneAlert.category}
                      </span>
                      <span className="bg-orange-700/80 px-2 py-0.5 rounded-md border border-orange-400/40">
                        {activeZoneAlert.incidentText}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDismissedZoneId(activeZoneAlert.zoneId)}
                  className="bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg transition shrink-0 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating live Radar incident Warnings panel */}
        <AnimatePresence>
          {proximityAlert && !activeZoneAlert && (
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
        animate={{ height: isSheetExpanded ? '560px' : '250px' }}
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
        <div className={`flex-1 overflow-y-auto px-4 pt-3 pb-28 space-y-4 text-left ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
          
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
                    const val = e.target.value;
                    setIsStartLinkedToGps(false);
                    setGpsStartNotice(null);
                    setStartQuery(val);
                    if (val.trim() === '') {
                      handleClearStartPoint();
                    } else {
                      setShowStartSuggestions(true);
                    }
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
                    type="button"
                    onClick={handleUseGpsForStart}
                    className={`p-1 ${darkMode ? 'text-slate-500 hover:text-blue-400' : 'text-slate-400 hover:text-blue-600'}`}
                    title="Use my location"
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
                          setIsStartLinkedToGps(false);
                          setGpsStartNotice(null);
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

            {!startPoint && endPoint && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-2.5 rounded-xl flex items-center justify-between gap-2 animate-fade-in">
                <span>{gpsStartNotice?.message || 'Waiting for a better GPS signal to use your current location...'}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {gpsStartNotice?.canOpenSettings && (
                    <button
                      type="button"
                      onClick={openGpsSettings}
                      className="underline font-bold text-blue-600 dark:text-blue-400 cursor-pointer"
                    >
                      Open settings
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveInputField('start')}
                    className="underline font-bold text-blue-600 dark:text-blue-400 cursor-pointer"
                  >
                    Pick start on map
                  </button>
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="bg-red-50 text-red-800 border border-red-200 text-xs font-semibold px-3 py-2 rounded-xl flex items-center justify-between gap-2 mt-2">
                <span>⚠️ {errorMessage}</span>
                <button
                  type="button"
                  onClick={() => calculateSafeDirections(startPoint, endPoint)}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg shrink-0 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}
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

                {/* Route score and factors matching active route */}
                <div className="bg-white/5 rounded-xl p-2.5 border border-white/10 space-y-1.5 text-[10px]">
                  <p className="font-extrabold uppercase tracking-wide text-indigo-300">Route Score Breakdown</p>
                  <div className="grid grid-cols-2 gap-1.5 px-1 text-slate-300">
                    <div>🔰 Route score: <strong className={activeRoute.safety === 'safe' ? 'text-emerald-400' : activeRoute.safety === 'moderate' ? 'text-amber-400' : 'text-red-400'}>{activeScore}/100</strong></div>
                    <div>🎯 Zone status: <strong className={activeRoute.safety === 'safe' ? 'text-emerald-400' : activeRoute.safety === 'moderate' ? 'text-amber-400' : 'text-red-400'}>{activeRoute.safety === 'safe' ? 'Fully Avoided' : activeRoute.safety === 'moderate' ? 'Near Perimeter' : 'Crosses Caution Area'}</strong></div>
                    <div>🛡️ Path type: <strong className="text-white">{activeRoute.name.includes("Avoids") || activeRoute.name.includes("Detour") || activeRoute.safety === 'safe' ? 'Avoidance Path' : 'Direct Path'}</strong></div>
                    <div>🚨 Status: <strong className={activeScore >= 85 ? 'text-emerald-400' : activeScore >= 70 ? 'text-amber-400' : 'text-red-400'}>{activeRoute.safety === 'safe' ? 'Cleared' : activeRoute.safety === 'moderate' ? 'Caution' : 'Elevated'}</strong></div>
                  </div>
                </div>
              </div>

              {/* MULTIPLE ALTERNATIVE PATHS SELECTOR */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">SUGGESTED ROUTE OPTIONS</p>
                  <span className="text-[10px] font-bold text-slate-500 font-mono">{routes.length} options available</span>
                </div>

                {isCheckingSaferRoutes && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 font-semibold animate-pulse py-0.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>Checking for safer routes...</span>
                  </div>
                )}

                {routeWarning && (
                  <div className="bg-amber-50 text-amber-900 border border-amber-200 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span>ℹ️</span>
                      <span>{routeWarning}</span>
                    </div>
                    {routeWarning.includes("Couldn't finish checking") && (
                      <button
                        type="button"
                        onClick={handleRetrySaferSearch}
                        disabled={isCheckingSaferRoutes}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] shrink-0 transition-colors cursor-pointer"
                      >
                        {isCheckingSaferRoutes ? 'Checking...' : 'Retry'}
                      </button>
                    )}
                  </div>
                )}

                <div className="flex gap-2.5 overflow-x-auto pb-1 max-w-full scrollbar-hide">
                  {routes.map((r, idx) => {
                    const isSelected = idx === activeRouteIndex;
                    const isSafe = r.safety === 'safe';
                    const isModerate = r.safety === 'moderate';

                    return (
                      <button
                        key={`alt-choice-${idx}`}
                        onClick={() => selectRoute(idx)}
                        className={`p-3 rounded-2xl border flex-shrink-0 w-52 text-left transition-all relative ${
                          isSelected 
                            ? 'bg-blue-50/90 border-blue-600 text-blue-950 ring-2 ring-blue-500 shadow-sm' 
                            : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-[11px] font-black block leading-snug line-clamp-1 ${isSelected ? 'text-blue-950' : 'text-slate-900'}`}>
                            {r.name}
                          </span>
                          <span className={`text-[9px] font-black font-mono px-1.5 py-0.5 rounded-md border shrink-0 ${
                            isSafe 
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                              : isModerate 
                              ? 'bg-amber-100 text-amber-800 border-amber-300' 
                              : 'bg-red-100 text-red-800 border-red-300'
                          }`}>
                            {r.safetyScore}%
                          </span>
                        </div>

                        <div className="text-[11px] font-extrabold text-slate-700 font-mono mt-1">
                          {(r.distance / 1000).toFixed(2)} km • {Math.max(1, Math.round(r.duration / 60))} min
                        </div>

                        {r.summaryText && (
                          <p className="text-[10px] text-slate-500 font-medium line-clamp-2 mt-1.5 pt-1 border-t border-slate-200/70 leading-tight">
                            {r.summaryText}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>

                {activeRoute?.summaryText && (
                  <div className="bg-slate-100 rounded-xl p-2.5 text-xs text-slate-700 font-semibold border border-slate-200 flex items-center gap-2">
                    <span className="text-sm">🧭</span>
                    <span>{activeRoute.summaryText}</span>
                  </div>
                )}
                <p className="text-[10px] text-slate-400 italic text-center">Based on recorded incidents. Not a guarantee of safety.</p>

                {showRouteDebug && activeRoute && (
                  <div 
                    id="route-debug-info-line" 
                    className="text-[10px] font-mono bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 rounded-lg px-2.5 py-1.5 flex items-center justify-between"
                  >
                    <span>
                      Selected route: {activeRoute.coordinates.length} points, in-zone segments: {activeInZoneSegments.length}, drawn: {activeInZoneSegments.length}, pane/zIndex: inZoneHeatmapPane/620
                    </span>
                    <button 
                      type="button" 
                      onClick={() => setShowRouteDebug(false)} 
                      className="text-amber-700 hover:text-amber-900 font-bold ml-2 text-[9px] cursor-pointer"
                      title="Dismiss debug line"
                    >
                      ✕
                    </button>
                  </div>
                )}
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
                    onClick={() => startSimulation(activeRouteIndex)}
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

                {/* Simulated Clock Override Selector (Active only during simulation) */}
                <div className="pt-2 border-t border-slate-200/80 space-y-2">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="font-extrabold text-slate-700 flex items-center gap-1 uppercase tracking-wider">
                      <Clock className="w-3 h-3 text-amber-500" /> Simulated Clock Override
                    </span>
                    {isSimulating && simulatedHour !== null ? (
                      <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded font-mono font-bold text-[10px]">
                        Simulated time: {String(Math.floor(simulatedHour)).padStart(2, '0')}:{String(Math.round((simulatedHour % 1) * 60)).padStart(2, '0')}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-semibold">
                        Real Manila Time
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-1 text-[11px] font-bold">
                    <button
                      type="button"
                      disabled={!isSimulating}
                      onClick={() => handleClockModeChange('now')}
                      className={`py-1.5 px-1 rounded-xl text-center transition-all ${
                        !isSimulating
                          ? 'opacity-40 bg-slate-100 text-slate-400 cursor-not-allowed'
                          : simClockMode === 'now'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      Now
                    </button>
                    <button
                      type="button"
                      disabled={!isSimulating}
                      onClick={() => handleClockModeChange('10pm')}
                      className={`py-1.5 px-1 rounded-xl text-center transition-all ${
                        !isSimulating
                          ? 'opacity-40 bg-slate-100 text-slate-400 cursor-not-allowed'
                          : simClockMode === '10pm'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      10 PM
                    </button>
                    <button
                      type="button"
                      disabled={!isSimulating}
                      onClick={() => handleClockModeChange('2pm')}
                      className={`py-1.5 px-1 rounded-xl text-center transition-all ${
                        !isSimulating
                          ? 'opacity-40 bg-slate-100 text-slate-400 cursor-not-allowed'
                          : simClockMode === '2pm'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      2 PM
                    </button>
                    <button
                      type="button"
                      disabled={!isSimulating}
                      onClick={() => handleClockModeChange('custom')}
                      className={`py-1.5 px-1 rounded-xl text-center transition-all ${
                        !isSimulating
                          ? 'opacity-40 bg-slate-100 text-slate-400 cursor-not-allowed'
                          : simClockMode === 'custom'
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      Custom
                    </button>
                  </div>

                  {isSimulating && simClockMode === 'custom' && (
                    <div className="flex items-center gap-2 pt-1 bg-white p-2 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-600 whitespace-nowrap">Hour:</span>
                      <input
                        type="range"
                        min={0}
                        max={23}
                        value={customSimHour}
                        onChange={(e) => handleClockModeChange('custom', parseInt(e.target.value, 10))}
                        className="flex-1 accent-purple-600 cursor-pointer"
                      />
                      <span className="text-xs font-mono font-black text-purple-700 w-12 text-right">
                        {String(customSimHour).padStart(2, '0')}:00
                      </span>
                    </div>
                  )}
                </div>
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
            <div id="palanan-map-empty-state-panel" className="flex flex-col justify-center items-center py-2 text-center space-y-2.5 select-none w-full max-w-xs mx-auto pb-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-full">
                <MapIcon className="w-7 h-7 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="space-y-1.5 w-full">
                <h3 className={`text-sm font-black ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                  🗺️ Plan Your Safe Route
                </h3>
                <div className={`text-[11px] leading-relaxed mx-auto space-y-1.5 p-3 rounded-2xl border text-left ${
                  darkMode ? 'bg-slate-950/80 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 text-[9px] font-bold flex items-center justify-center rounded-full shrink-0">1</span>
                    <span className="font-semibold">Select Start Location</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 text-[9px] font-bold flex items-center justify-center rounded-full shrink-0">2</span>
                    <span className="font-semibold">Select Destination</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 text-[9px] font-bold flex items-center justify-center rounded-full shrink-0">3</span>
                    <span className="font-semibold">Generate Route</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 max-w-[260px] mx-auto text-center leading-relaxed font-semibold">
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

    </div>
  );
}
