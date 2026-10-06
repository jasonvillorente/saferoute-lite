import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap, Rectangle } from 'react-leaflet';
import L from 'leaflet';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { syncReportToAllCollections } from '../lib/syncHelper';
import { getCurrentGpsPosition, requestLocationPermission } from '../lib/nativeLocation';
import { isInsidePalanan, PALANAN_BOUNDS } from '../lib/palananBounds';
import { isDemoMode as calculateDemoMode } from '../config/demo';
import { 
  AlertTriangle, 
  AlertCircle,
  MapPin, 
  Camera, 
  Info, 
  Loader2, 
  Check, 
  Trash2, 
  Compass,
  Map as MapIcon,
  X,
  ShieldAlert
} from 'lucide-react';

// Leaflet markers shadow url
const markerShadow = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

const reportIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Map click handler sub-component
function MapEventsHandler({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onSelect(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

// Pan map smoothly when location changes
function MapViewUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (map && center) {
      map.setView(center, map.getZoom() || 15);
    }
  }, [center[0], center[1], map]);
  return null;
}

export default function Report() {
  const [description, setDescription] = useState('');
  const { user, profile, isDemoMode: authIsDemoMode } = useAuth();
  const isDemo = authIsDemoMode ?? calculateDemoMode(user, profile);
  const { darkMode } = useTheme();
  const navigate = useNavigate();

  // Feature states
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationName, setLocationName] = useState('');
  const [geolocationLoading, setGeolocationLoading] = useState(false);
  
  // Boundary validation & error states
  const [isOutsidePalananState, setIsOutsidePalananState] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showDemoModal, setShowDemoModal] = useState(false);

  // References
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const mapSectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image states
  const [imageUrl, setImageUrl] = useState('');

  const getCategoryFromText = (text: string): string => {
    const norm = text.toLowerCase();
    if (norm.includes('flood') || norm.includes('rain') || norm.includes('water')) return 'Flood Risk';
    if (norm.includes('light') || norm.includes('dark') || norm.includes('night') || norm.includes('lamp')) return 'Poor Lighting';
    if (norm.includes('construct') || norm.includes('roadwork') || norm.includes('work')) return 'Construction Area';
    if (norm.includes('accident') || norm.includes('crash') || norm.includes('car')) return 'Accident-Prone Area';
    if (norm.includes('suspicious') || norm.includes('stranger') || norm.includes('stalker')) return 'Suspicious Activity';
    if (norm.includes('crime') || norm.includes('rob') || norm.includes('steal') || norm.includes('fight') || norm.includes('theft')) return 'Crime';
    return 'General Hazard';
  };

  // Real-time Geolocation trigger using existing native GPS implementation
  const handleGetLocation = async () => {
    setGeolocationLoading(true);
    setLocationError(null);
    setIsOutsidePalananState(false);

    try {
      await requestLocationPermission();
      const pos = await getCurrentGpsPosition();
      
      const lat = pos.latitude;
      const lng = pos.longitude;
      const acc = pos.accuracy;

      // 1. Obtain and retain the user's ACTUAL GPS coordinates (NEVER substitute or clamp)
      const actualLocation = { lat, lng };
      setLocation(actualLocation);
      setLocationAccuracy(acc);

      // 2. Validate whether actual GPS coordinate is inside Barangay Palanan boundary
      const inside = isInsidePalanan(lat, lng);
      if (!inside) {
        setIsOutsidePalananState(true);
        setLocationError(
          'You are outside Barangay Palanan. You must be within Barangay Palanan to submit a danger report.'
        );
      } else {
        setIsOutsidePalananState(false);
        setLocationError(null);
      }

      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 150);
    } catch (error) {
      console.warn('Geolocation failed:', error);
      setIsOutsidePalananState(false);
      setLocationError(
        'Unable to get your current location. Please enable location services or tap on the map within Barangay Palanan to pin the hazard.'
      );
    } finally {
      setGeolocationLoading(false);
    }
  };

  // Handle map selection / marker drag events
  const handleMapSelect = (lat: number, lng: number, landmark?: string) => {
    setLocation({ lat, lng });
    setLocationAccuracy(null);
    if (landmark) {
      setLocationName(landmark);
    }

    const inside = isInsidePalanan(lat, lng);
    if (!inside) {
      setIsOutsidePalananState(true);
      setLocationError(
        'You are outside Barangay Palanan. You must be within Barangay Palanan to submit a danger report.'
      );
    } else {
      setIsOutsidePalananState(false);
      setLocationError(null);
    }
  };

  // Image upload with automatic client-side compression
  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);
          setImageUrl(compressedDataUrl);
        } else {
          setImageUrl(event.target?.result as string);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setImageUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Check if location is pinned
    if (!location) {
      setLocationError('Please pin your location before submitting. Tapping "Pin Location" now...');
      mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      handleGetLocation();
      return;
    }

    // 2. Final boundary check
    if (!isInsidePalanan(location.lat, location.lng)) {
      setIsOutsidePalananState(true);
      setLocationError(
        'You are outside Barangay Palanan. You must be within Barangay Palanan to submit a danger report.'
      );
      mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    // 3. Check if description is present
    if (!description.trim()) {
      descriptionInputRef.current?.focus();
      return;
    }

    // 4. Demo Mode Check (Only blocks the explicit Guest Demo account)
    if (isDemo) {
      setShowDemoModal(true);
      return;
    }
    
    setLoading(true);
    try {
      const category = getCategoryFromText(description);
      
      const currentUid = user?.uid || profile?.uid || 'resident-anon';
      const reporterFullName = profile?.name || user?.displayName || 'Resident';
      const reporterContact = user?.phoneNumber || profile?.phoneNumber || user?.email || profile?.email || 'resident@saferoute.local';

      // Submit synced report to all database collections using ACTUAL coordinates
      await syncReportToAllCollections({
        reporterId: currentUid,
        reporterName: reporterFullName,
        reporterEmail: reporterContact,
        description,
        status: 'pending',
        location: { lat: location.lat, lng: location.lng },
        category,
        locationName: locationName.trim() || 'Barangay Palanan',
        imageUrl: imageUrl || undefined
      });
      
      setSuccess(true);
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      console.error('Error submitting report:', err);
      setLocationError('Failed to submit report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="h-[75vh] flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-300">
        <div className={`p-6 rounded-full mb-6 animate-bounce ${darkMode ? 'bg-green-950/45' : 'bg-green-100'}`}>
          <Check className="w-12 h-12 text-green-500" />
        </div>
        <h2 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-slate-900'}`}>Report Submitted!</h2>
        <p className={`max-w-sm text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          Barangay officials will verify your report shortly. Thank you for keeping our community safe.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <div className="flex items-center justify-between">
          <h1 className={`text-2xl font-bold flex items-center gap-2 ${darkMode ? 'text-white' : 'text-slate-900'}`}>
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            <span>Report Hazard</span>
          </h1>
          {isDemo && (
            <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">
              Demo Mode
            </span>
          )}
        </div>
        <p className={`text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Help fellow residents bypass and avoid unsafe locations.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <label className="block">
            <span className={`text-sm font-bold block mb-2 uppercase tracking-wide ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              Tell us what happened
            </span>
            <textarea
              ref={descriptionInputRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the unsafe situation (e.g., suspicious activity, water-logged flood risk, construction obstacles, faulty street lamps)"
              className={`w-full border rounded-3xl p-4 min-h-[130px] focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium border-solid shadow-sm ${
                darkMode 
                  ? 'bg-slate-900 border-slate-800 text-white placeholder:text-slate-500' 
                  : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
              }`}
              required
            />
          </label>

          {/* Hidden File Input */}
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />

          {/* Action Choice Buttons */}
          <div className="grid grid-cols-2 gap-4">
            <button 
              type="button" 
              onClick={handleGetLocation}
              disabled={geolocationLoading}
              className={`p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-sm border font-semibold cursor-pointer ${
                location && !isOutsidePalananState
                  ? (darkMode ? 'bg-indigo-950/40 border-indigo-900/50 text-indigo-400' : 'bg-indigo-50 border-indigo-200 text-indigo-700') 
                  : isOutsidePalananState
                  ? (darkMode ? 'bg-red-950/40 border-red-900/50 text-red-400' : 'bg-red-50 border-red-200 text-red-700')
                  : (darkMode ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700')
              }`}
            >
              {geolocationLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              ) : (
                <Compass className="w-5 h-5 text-blue-600" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {geolocationLoading ? 'Acquiring GPS...' : location && !isOutsidePalananState ? 'GPS Location Pinned' : isOutsidePalananState ? 'Outside Palanan' : 'Pin Location'}
              </span>
            </button>
            
            <button 
              type="button" 
              onClick={handlePhotoClick}
              className={`p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-sm border font-semibold cursor-pointer ${
                imageUrl 
                  ? (darkMode ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700') 
                  : (darkMode ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700')
              }`}
            >
              <Camera className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {imageUrl ? 'Photo Added' : 'Add Photo'}
              </span>
            </button>
          </div>

          {/* Warning Banner: User is outside Barangay Palanan */}
          {isOutsidePalananState && (
            <div className={`p-4 rounded-3xl border flex items-start gap-3 animate-in fade-in duration-200 ${
              darkMode ? 'bg-red-950/40 border-red-900/60 text-red-200' : 'bg-red-50 border-red-200 text-red-900'
            }`}>
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs text-left">
                <p className="font-bold text-sm text-red-600 dark:text-red-400">
                  You are outside Barangay Palanan.
                </p>
                <p className="font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                  You must be within Barangay Palanan to submit a danger report.
                </p>
              </div>
            </div>
          )}

          {/* Warning Banner: GPS could not be obtained */}
          {!isOutsidePalananState && locationError && (
            <div className={`p-4 rounded-3xl border flex items-start gap-3 animate-in fade-in duration-200 ${
              darkMode ? 'bg-amber-950/30 border-amber-900/50 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs text-left">
                <p className="font-bold text-sm text-amber-600 dark:text-amber-400">
                  Unable to get your current location.
                </p>
                <p className="font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                  Please enable location services or tap on the map within Barangay Palanan below to pin the location.
                </p>
              </div>
            </div>
          )}

          {/* Image Preview Container */}
          {imageUrl && (
            <div className={`relative border p-3 rounded-3xl shadow-inner flex items-center justify-between ${
              darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-100 bg-slate-50'
            }`}>
              <div className="flex items-center gap-3">
                <img 
                  src={imageUrl} 
                  alt="Hazard capture" 
                  className={`w-16 h-16 object-cover rounded-2xl border shadow-sm ${
                    darkMode ? 'border-slate-800' : 'border-slate-200'
                  }`}
                />
                <div>
                  <h4 className={`text-[11px] font-bold uppercase tracking-wide ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>Ready for submission</h4>
                  <p className="text-[10px] text-slate-500">Hazard attachment uploaded</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={handleRemovePhoto}
                className={`p-2.5 rounded-2xl transition-all cursor-pointer ${
                  darkMode ? 'bg-red-950/40 text-red-400 hover:bg-red-950/70' : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
                title="Remove photo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Pinned Location Map Preview - Only appears when location is pinpointed */}
          {location && (
            <div ref={mapSectionRef} className={`space-y-3 p-4 border rounded-3xl shadow-sm animate-in fade-in duration-200 ${
              darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapIcon className={`w-4 h-4 ${isOutsidePalananState ? 'text-red-500' : 'text-blue-500'}`} />
                  <span className={`text-xs font-bold uppercase tracking-wider ${
                    isOutsidePalananState 
                      ? (darkMode ? 'text-red-400' : 'text-red-600') 
                      : (darkMode ? 'text-blue-400' : 'text-blue-600')
                  }`}>
                    {isOutsidePalananState ? 'Location Outside Palanan' : 'Hazard Location Pinned'}
                  </span>
                </div>
                <div className={`text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full ${
                  isOutsidePalananState
                    ? (darkMode ? 'bg-red-950/60 text-red-300 border border-red-900/60' : 'bg-red-100 text-red-800 border border-red-200')
                    : (darkMode ? 'bg-blue-950/50 text-blue-400 border border-blue-900/50' : 'bg-blue-100 text-blue-800 border border-blue-200')
                }`}>
                  {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                </div>
              </div>

              {locationAccuracy !== null && locationAccuracy > 0 && (
                <div className="text-[10px] text-slate-500 font-medium px-1">
                  GPS Accuracy: ±{Math.round(locationAccuracy)}m
                </div>
              )}

              {/* Interactive Leaflet Map Picker */}
              <div className={`h-60 relative w-full rounded-2xl overflow-hidden border shadow-sm z-10 ${
                isOutsidePalananState 
                  ? (darkMode ? 'border-red-900/60' : 'border-red-300') 
                  : (darkMode ? 'border-blue-900/60' : 'border-blue-300')
              }`}>
                <MapContainer 
                  center={[location.lat, location.lng]} 
                  zoom={16} 
                  className="w-full h-full"
                  scrollWheelZoom={false}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; OpenStreetMap contributors'
                  />
                  <MapViewUpdater center={[location.lat, location.lng]} />
                  <MapEventsHandler onSelect={handleMapSelect} />

                  {/* Visual Barangay Palanan Boundary Outline */}
                  <Rectangle 
                    bounds={PALANAN_BOUNDS}
                    pathOptions={{
                      color: isOutsidePalananState ? '#ef4444' : '#2563eb',
                      weight: 2,
                      dashArray: '5, 5',
                      fillColor: '#2563eb',
                      fillOpacity: 0.06
                    }}
                  />

                  {/* Marker at ACTUAL coordinates (Never moved or clamped) */}
                  <Marker 
                    position={[location.lat, location.lng]} 
                    icon={reportIcon}
                    draggable={true}
                    eventHandlers={{
                      dragend: (e) => {
                        const marker = e.target;
                        const pos = marker.getLatLng();
                        handleMapSelect(pos.lat, pos.lng);
                      }
                    }}
                  />
                </MapContainer>
              </div>

              <div className="space-y-1 pt-1">
                <span className={`text-[11px] font-bold block uppercase tracking-wide ${darkMode ? 'text-slate-400' : 'text-slate-700'}`}>
                  Landmark name or Street address
                </span>
                <input 
                  type="text" 
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="e.g. Tramo St. corner Sandejas, near store"
                  className={`w-full border rounded-2xl px-4 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium border-solid ${
                    darkMode 
                      ? 'bg-slate-950 border-slate-800 text-white placeholder:text-slate-500' 
                      : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
                  }`}
                />
              </div>
            </div>
          )}
        </div>

        <div className={`p-4 rounded-3xl flex gap-3 border ${
          darkMode ? 'bg-orange-950/20 border-orange-900/30' : 'bg-orange-50 border-orange-100'
        }`}>
          <Info className="w-5 h-5 text-orange-500 shrink-0" />
          <p className={`text-[11px] leading-relaxed font-medium ${darkMode ? 'text-orange-400/90' : 'text-orange-800'}`}>
            Your report will be reviewed by Barangay Admins before it goes live on the safety map interface.
          </p>
        </div>

        {/* Dynamic & Interactive Submission Button */}
        <button
          type="submit"
          disabled={loading}
          className={`w-full font-bold py-5 rounded-3xl shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer ${
            loading
              ? 'opacity-60 cursor-not-allowed bg-slate-700 text-white'
              : isOutsidePalananState
              ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-200 dark:shadow-none'
              : !location
              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200 dark:shadow-none'
              : !description.trim()
              ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-200 dark:shadow-none'
              : darkMode 
              ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-slate-950/40' 
              : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-300'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Submitting Report...</span>
            </>
          ) : isOutsidePalananState ? (
            <>
              <AlertCircle className="w-5 h-5 text-white" />
              <span>Blocked (Location Outside Palanan)</span>
            </>
          ) : !location ? (
            <>
              <MapPin className="w-5 h-5" />
              <span>Pin Location to Submit</span>
            </>
          ) : !description.trim() ? (
            <>
              <AlertTriangle className="w-5 h-5" />
              <span>Please Describe Hazard to Submit</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-5 h-5" />
              <span>Submit Hazard Report</span>
            </>
          )}
        </button>
      </form>

      {/* Demo Mode Notice Modal */}
      {showDemoModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className={`w-full max-w-sm p-6 rounded-3xl border shadow-2xl space-y-4 text-center ${
            darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-black text-amber-500">
                Demo Mode: Reporting is disabled.
              </h3>
              <p className={`text-xs leading-relaxed font-semibold ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                Danger reports cannot be submitted during the demonstration to prevent false or test reports.
              </p>
              <div className="text-[11px] font-bold text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-2.5 mt-2">
                No report was submitted to Firebase.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowDemoModal(false)}
              className="w-full py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
            >
              Understood
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
