import React from 'react';
import { Crosshair, AlertTriangle } from 'lucide-react';
import { LocationStatus } from '../lib/locationTracker';

interface GpsStatusChipProps {
  status: LocationStatus;
  isStale: boolean;
  accuracy: number | null;
  autoFollow: boolean;
  onRecenter: () => void;
  onRequestPermission: () => void;
  onOpenSettings: () => void;
}

export const GpsStatusChip: React.FC<GpsStatusChipProps> = ({
  status,
  isStale,
  accuracy,
  autoFollow,
  onRecenter,
  onRequestPermission,
  onOpenSettings,
}) => {
  let label = 'Searching for GPS...';
  let dotBg = 'bg-blue-500 animate-pulse';
  let isActionable = false;
  let actionType: 'recenter' | 'permission' | 'settings' = 'recenter';

  if (status === 'denied') {
    label = 'Location permission denied';
    dotBg = 'bg-red-500';
    isActionable = true;
    actionType = 'permission';
  } else if (status === 'off') {
    label = 'Location off';
    dotBg = 'bg-red-500';
    isActionable = true;
    actionType = 'settings';
  } else if (isStale || status === 'lost') {
    label = 'GPS lost';
    dotBg = 'bg-slate-400';
  } else if (status === 'weak') {
    label = accuracy ? `GPS weak (±${Math.round(accuracy)}m)` : 'GPS weak';
    dotBg = 'bg-amber-500';
  } else if (status === 'strong') {
    label = accuracy ? `GPS strong (±${Math.round(accuracy)}m)` : 'GPS strong';
    dotBg = 'bg-emerald-500';
  }

  const handleClick = () => {
    if (actionType === 'permission') {
      onRequestPermission();
    } else if (actionType === 'settings') {
      onOpenSettings();
    } else {
      onRecenter();
    }
  };

  return (
    <div className="flex items-center gap-1.5 select-none pointer-events-auto">
      {/* GPS Status Badge */}
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-md border border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition cursor-pointer"
        title={isActionable ? 'Click to enable location' : 'GPS signal status'}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotBg}`} />
        <span>{label}</span>
        {isActionable && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0 ml-0.5" />}
      </button>

      {/* Recenter Button */}
      <button
        type="button"
        onClick={onRecenter}
        className={`p-1.5 rounded-full shadow-md border backdrop-blur-md transition cursor-pointer ${
          autoFollow
            ? 'bg-[#4285F4] text-white border-[#4285F4]'
            : 'bg-white/95 text-slate-700 hover:bg-slate-50 border-slate-200'
        }`}
        title={autoFollow ? 'Auto-follow active (Centered on you)' : 'Recenter map on your location'}
        aria-label="Recenter on your location"
      >
        <Crosshair className={`w-4 h-4 ${autoFollow ? 'text-white' : 'text-slate-700'}`} />
      </button>
    </div>
  );
};
