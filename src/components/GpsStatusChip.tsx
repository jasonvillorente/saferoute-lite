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
    label = 'GPS denied';
    dotBg = 'bg-red-500';
    isActionable = true;
    actionType = 'permission';
  } else if (status === 'off') {
    label = 'GPS off';
    dotBg = 'bg-red-500';
    isActionable = true;
    actionType = 'settings';
  } else if (isStale || status === 'lost') {
    label = 'GPS lost';
    dotBg = 'bg-slate-400';
  } else if (status === 'weak') {
    label = accuracy ? `Weak ±${Math.round(accuracy)}m` : 'Weak';
    dotBg = 'bg-amber-500';
  } else if (status === 'strong') {
    label = accuracy ? `GPS ±${Math.round(accuracy)}m` : 'GPS';
    dotBg = 'bg-emerald-500';
  } else {
    label = 'Searching...';
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
    <div className="flex items-center gap-1 select-none pointer-events-auto">
      {/* GPS Status Badge */}
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-md border border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition cursor-pointer whitespace-nowrap"
        title={isActionable ? 'Click to enable location' : 'GPS signal status'}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotBg}`} />
        <span>{label}</span>
        {isActionable && <AlertTriangle className="w-2.5 h-2.5 text-red-500 shrink-0 ml-0.5" />}
      </button>

      {/* Recenter Button */}
      <button
        type="button"
        onClick={onRecenter}
        className={`p-1 rounded-full shadow-md border backdrop-blur-md transition cursor-pointer shrink-0 ${
          autoFollow
            ? 'bg-[#4285F4] text-white border-[#4285F4]'
            : 'bg-white/95 text-slate-700 hover:bg-slate-50 border-slate-200'
        }`}
        title={autoFollow ? 'Auto-follow active (Centered on you)' : 'Recenter map on your location'}
        aria-label="Recenter on your location"
      >
        <Crosshair className={`w-3.5 h-3.5 ${autoFollow ? 'text-white' : 'text-slate-700'}`} />
      </button>
    </div>
  );
};
