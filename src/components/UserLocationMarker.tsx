import React from 'react';
import { Marker, Circle, Popup } from 'react-leaflet';
import L from 'leaflet';
import { AlertCircle } from 'lucide-react';

export interface UserLocationMarkerProps {
  position: [number, number];
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  status: string;
  isStale: boolean;
  isOutsidePalanan: boolean;
  isSimulating?: boolean;
  autoFollow: boolean;
  onToggleAutoFollow: () => void;
}

/**
 * Creates the Google Maps-style DivIcon:
 * - 18px center dot (#4285F4 or grey #9AA0A6 on stale)
 * - 3px crisp white border with soft drop shadow
 * - 60-degree soft blue directional beam when heading is known
 * - Expanding CSS pulse ring while acquiring / moving
 */
export function createUserLocationPuckIcon(
  heading: number | null,
  isStale: boolean,
  isSimulating: boolean = false
): L.DivIcon {
  const isGrey = isStale && !isSimulating;
  const dotColor = isGrey ? '#9AA0A6' : '#4285F4';
  const hasHeading = !isGrey && typeof heading === 'number' && !isNaN(heading);

  const html = `
    <div class="user-location-puck relative flex items-center justify-center w-12 h-12 -ml-6 -mt-6 select-none pointer-events-auto">
      ${
        hasHeading
          ? `
        <div class="user-heading-cone absolute inset-0 flex items-center justify-center pointer-events-none" style="transform: rotate(${heading}deg); transform-origin: center center;">
          <svg viewBox="0 0 100 100" class="w-14 h-14 overflow-visible">
            <defs>
              <radialGradient id="userBeamGrad-${isGrey ? 'grey' : 'blue'}" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                <stop offset="0%" stop-color="#4285F4" stop-opacity="0.45" />
                <stop offset="65%" stop-color="#4285F4" stop-opacity="0.18" />
                <stop offset="100%" stop-color="#4285F4" stop-opacity="0" />
              </radialGradient>
            </defs>
            <!-- 60-degree field beam pointing forward (north) -->
            <path d="M 50 50 L 25 6 A 50 50 0 0 1 75 6 Z" fill="url(#userBeamGrad-${isGrey ? 'grey' : 'blue'})" />
          </svg>
        </div>
      `
          : ''
      }
      ${
        !isGrey
          ? `
        <span class="user-location-pulse absolute w-7 h-7 rounded-full animate-ping pointer-events-none" style="background-color: rgba(66, 133, 244, 0.28); animation-duration: 2.2s;"></span>
      `
          : ''
      }
      <div class="user-location-dot relative rounded-full shadow-md transition-colors duration-300"
           style="width: 18px; height: 18px; background-color: ${dotColor}; border: 3px solid #FFFFFF; box-shadow: 0 2px 6px rgba(0,0,0,0.32);">
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: `custom-user-location-marker ${isGrey ? 'is-stale-marker' : 'is-active-marker'}`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

export const UserLocationMarker: React.FC<UserLocationMarkerProps> = ({
  position,
  accuracy,
  heading,
  speed,
  status,
  isStale,
  isOutsidePalanan,
  isSimulating = false,
  autoFollow,
  onToggleAutoFollow,
}) => {
  const icon = createUserLocationPuckIcon(heading, isStale, isSimulating);

  // Translucent blue accuracy circle: radius capped at 100m, hidden when simulating or stale
  const showAccuracyCircle = !isSimulating && !isStale && accuracy !== null && accuracy > 0;
  const clampedRadius = accuracy !== null ? Math.min(100, Math.max(accuracy, 5)) : 0;

  return (
    <>
      <Marker position={position} icon={icon} zIndexOffset={1000}>
        <Popup>
          <div className="text-xs p-1 min-w-[170px] text-left">
            {isOutsidePalanan ? (
              <div className="p-2 -m-1 mb-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                <span className="font-bold text-xs flex items-center gap-1.5 text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Outside Palanan
                </span>
                <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
                  SafeRoute safety alerts and navigation are centered on Barangay Palanan.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mb-1 font-bold text-slate-900">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: isStale ? '#9AA0A6' : '#4285F4' }}
                />
                <span>{isSimulating ? 'Simulated Walking Position' : isStale ? 'Location (Offline / Stale)' : 'Your Location'}</span>
              </div>
            )}

            {!isSimulating && (
              <p className="text-[10px] text-slate-600 font-medium">
                {isStale
                  ? 'No GPS fix for 15+ seconds'
                  : accuracy
                  ? `Accuracy: ±${Math.round(accuracy)}m (${status === 'strong' ? 'Strong' : 'Weak'})`
                  : 'Acquiring GPS fix...'}
              </p>
            )}

            {speed !== null && speed > 0.3 && (
              <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                Moving: {(speed * 3.6).toFixed(1)} km/h
              </p>
            )}

            <button
              type="button"
              onClick={onToggleAutoFollow}
              className={`mt-2 w-full py-1 px-2 rounded-lg text-[10px] font-bold cursor-pointer transition ${
                autoFollow ? 'bg-[#4285F4] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {autoFollow ? '✓ Auto-Follow On' : 'Enable Auto-Follow'}
            </button>
          </div>
        </Popup>
      </Marker>

      {showAccuracyCircle && (
        <Circle
          center={position}
          radius={clampedRadius}
          pathOptions={{
            fillColor: '#4285F4',
            fillOpacity: 0.12,
            color: '#4285F4',
            opacity: 0.25,
            weight: 1,
          }}
        />
      )}
    </>
  );
};
