import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { syncReportToAllCollections } from '../lib/syncHelper';
import { 
  AlertTriangle, 
  MapPin, 
  Camera, 
  Info, 
  Loader2, 
  Check, 
  Trash2, 
  Compass,
  Map as MapIcon,
  X
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

// A small sub-component to catch map clicks
function MapEventsHandler({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onSelect(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

export default function Report() {
  const [description, setDescription] = useState('');
  const { user, profile } = useAuth();
  const { darkMode } = useTheme();
  const navigate = useNavigate();

  // Feature states
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [location, setLocation] = useState({ lat: 14.56038, lng: 120.99800 }); // Default centered on Palanan
  const [locationName, setLocationName] = useState('');
  const [geolocationLoading, setGeolocationLoading] = useState(false);
  
  // Image states
  const [imageUrl, setImageUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Geolocation trigger
  const handleGetLocation = () => {
    setGeolocationLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLoc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setLocation(newLoc);
          setGeolocationLoading(false);
          setShowMap(true);
          // Trigger a window resize event to allow Leaflet to recalculate space
          setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
          }, 150);
        },
        (error) => {
          console.warn('Geolocation failed, falling back to default/manual selection:', error);
          setGeolocationLoading(false);
          setShowMap(true);
          setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
          }, 150);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setGeolocationLoading(false);
      setShowMap(true);
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 150);
    }
  };

  // Image upload
  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemovePhoto = () => {
    setImageUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setLoading(true);
    try {
      const category = getCategoryFromText(description);
      
      // Submit synced report to all database collections
      await syncReportToAllCollections({
        reporterId: user.uid,
        reporterName: profile?.name || 'Resident',
        reporterEmail: user.email || profile?.email || 'resident@saferoute.local',
        description,
        status: 'pending',
        location,
        category,
        locationName: locationName.trim() || 'Barangay Palanan',
        imageUrl: imageUrl || undefined
      });
      
      setSuccess(true);
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      console.error('Error submitting report:', err);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="h-[75vh] flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-300">
        <div className={`p-6 rounded-full mb-6 animate-bounce ${darkMode ? 'bg-green-950/45' : 'bg-green-100'}`}>
          <Check className="w-12 h-12 text-green-550" />
        </div>
        <h2 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-slate-900'}`}>Report Submitted!</h2>
        <p className={`max-w-sm text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Barangay officials will verify your report shortly. Thank you for keeping us safe.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className={`text-2xl font-bold flex items-center gap-2 ${darkMode ? 'text-white' : 'text-slate-900'}`}>
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <span>Report Hazard</span>
        </h1>
        <p className={`text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Help fellow residents bypass and avoid unsafe locations.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <label className="block">
            <span className={`text-sm font-bold block mb-2 uppercase tracking-wide ${darkMode ? 'text-slate-350' : 'text-slate-700'}`}>Tell us what happened</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the unsafe situation (e.g., suspicious activity, water-logged flood risk, construction obstacles, faulty street lamps)"
              className={`w-full border rounded-3xl p-4 min-h-[140px] focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium border-solid shadow-sm ${
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
              className={`p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-sm border font-semibold ${
                showMap 
                  ? (darkMode ? 'bg-indigo-950/40 border-indigo-900/50 text-indigo-400' : 'bg-indigo-50 border-indigo-200 text-indigo-700') 
                  : (darkMode ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800' : 'bg-slate-100 border-slate-100 hover:bg-slate-200 text-slate-700')
              }`}
            >
              {geolocationLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Compass className="w-5 h-5" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {showMap ? 'Location Pinned' : 'Pin Location'}
              </span>
            </button>
            
            <button 
              type="button" 
              onClick={handlePhotoClick}
              className={`p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-sm border font-semibold ${
                imageUrl 
                  ? (darkMode ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700') 
                  : (darkMode ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800' : 'bg-slate-100 border-slate-100 hover:bg-slate-200 text-slate-700')
              }`}
            >
              <Camera className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {imageUrl ? 'Photo Added' : 'Add Photo'}
              </span>
            </button>
          </div>

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
                className={`p-2.5 rounded-2xl transition-all ${
                  darkMode ? 'bg-red-950/40 text-red-400 hover:bg-red-950/70' : 'bg-red-50 text-red-650 hover:bg-red-100'
                }`}
                title="Remove photo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Map Selector Container */}
          {showMap && (
            <div className={`space-y-3 p-4 border rounded-3xl shadow-inner animate-fade-in ${
              darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-100'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapIcon className="w-4 h-4 text-indigo-500" />
                  <span className={`text-xs font-bold uppercase tracking-wider ${darkMode ? 'text-slate-300' : 'text-slate-800'}`}>Drag to specify location</span>
                </div>
                <div className={`text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full ${
                  darkMode ? 'bg-indigo-950/50 text-indigo-400' : 'bg-indigo-100 text-indigo-800'
                }`}>
                  {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                </div>
              </div>

              {/* Leaflet Map Picker */}
              <div className={`h-56 relative w-full rounded-2xl overflow-hidden border shadow-sm z-10 ${
                darkMode ? 'border-slate-800' : 'border-slate-200'
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
                  <MapEventsHandler onSelect={(lat, lng) => setLocation({ lat, lng })} />
                  <Marker 
                    position={[location.lat, location.lng]} 
                    icon={reportIcon}
                    draggable={true}
                    eventHandlers={{
                      dragend: (e) => {
                        const marker = e.target;
                        const pos = marker.getLatLng();
                        setLocation({ lat: pos.lat, lng: pos.lng });
                      }
                    }}
                  />
                </MapContainer>
              </div>

              <div className="space-y-1">
                <span className={`text-[11px] font-bold block uppercase tracking-wide ${darkMode ? 'text-slate-400' : 'text-slate-700'}`}>Landmark name or Street address</span>
                <input 
                  type="text" 
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="e.g. Tramo St. corner Sandejas, near store"
                  className={`w-full border rounded-2xl px-4 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium border-solid ${
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

        <button
          type="submit"
          disabled={loading || !description}
          className={`w-full font-bold py-5 rounded-3xl shadow-xl active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
            darkMode 
              ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-slate-950/40' 
              : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-200'
          }`}
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
            <>
              <AlertTriangle className="w-5 h-5" />
              Submit Report
            </>
          )}
        </button>
      </form>
    </div>
  );
}

