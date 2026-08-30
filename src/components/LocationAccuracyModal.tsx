import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Target, ShieldCheck, Lock } from 'lucide-react';

interface LocationAccuracyModalProps {
  isOpen: boolean;
  onTurnOn: () => void;
  onDismiss: () => void;
}

// SafeRoute Shield Logo
const SafeRouteShieldLogo: React.FC<{ className?: string }> = ({ className = "w-12 h-14" }) => (
  <div className={`relative flex items-center justify-center shrink-0 ${className}`}>
    <svg viewBox="0 0 100 120" className="w-full h-full drop-shadow-sm" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer Red Shield Border */}
      <path
        d="M50 4L92 20V58C92 88 50 114 50 114C50 114 8 88 8 58V20L50 4Z"
        fill="#fef2f2"
        stroke="#dc2626"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      {/* Inner Road Curve in Dark Slate */}
      <path
        d="M32 94L44 48H56L68 94C62 98 56 100 50 102C44 100 38 98 32 94Z"
        fill="#1e293b"
      />
      {/* Road Dashed Center Line */}
      <line x1="50" y1="56" x2="50" y2="64" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="50" y1="72" x2="50" y2="82" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="50" y1="88" x2="50" y2="96" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      
      {/* Red Location Pin at Top Center */}
      <path
        d="M50 20C42.268 20 36 26.268 36 34C36 44 50 56 50 56C50 56 64 44 64 34C64 26.268 57.732 20 50 20Z"
        fill="#dc2626"
      />
      {/* White Pin Inner Dot */}
      <circle cx="50" cy="33" r="5" fill="white" />
    </svg>
  </div>
);

export const LocationAccuracyModal: React.FC<LocationAccuracyModalProps> = ({
  isOpen,
  onTurnOn,
  onDismiss,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 cursor-pointer"
            onClick={onDismiss}
          />

          {/* Compact SafeRoute Lite Location Modal Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="relative w-full max-w-[390px] sm:max-w-[400px] bg-white text-slate-900 rounded-[24px] shadow-2xl border border-slate-200/90 z-10 overflow-hidden font-sans select-none flex flex-col my-auto max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* SCROLLABLE INNER BODY */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 text-left space-y-3.5">
              
              {/* Header: Shield + Title */}
              <div className="flex items-start gap-3">
                <SafeRouteShieldLogo className="w-10 h-12 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-[17px] sm:text-[18px] font-bold tracking-tight text-slate-900 leading-snug">
                    To continue using <span className="text-[#166534]">SafeRoute Lite</span>, we need access to your location
                  </h3>
                  <p className="text-[12px] sm:text-[12.5px] text-slate-600 font-normal leading-relaxed mt-1.5">
                    SafeRoute Lite uses your location to help you find safer routes and stay informed about your surroundings.
                  </p>
                </div>
              </div>

              {/* Subheader Title */}
              <div className="pt-0.5">
                <p className="text-[12px] font-bold text-[#166534] uppercase tracking-wider">
                  The following settings should be on:
                </p>
              </div>

              {/* Settings Items */}
              <div className="space-y-2.5">
                {/* Item 1: Device location */}
                <div className="flex items-start gap-3 bg-[#f8faf8] p-2.5 rounded-xl border border-slate-100">
                  <div className="w-8 h-8 rounded-full bg-[#eaf5ec] flex items-center justify-center shrink-0 text-[#166534] mt-0.5">
                    <MapPin className="w-4 h-4 fill-[#166534]/20 stroke-[#166534] stroke-[2.2]" />
                  </div>
                  <div className="text-left flex-1">
                    <h4 className="text-[13.5px] font-bold text-slate-900">
                      Device location
                    </h4>
                    <p className="text-[11.5px] text-slate-600 leading-normal mt-0.5">
                      Allows SafeRoute Lite to know your current location.
                    </p>
                  </div>
                </div>

                {/* Item 2: Location Accuracy (Recommended) */}
                <div className="flex items-start gap-3 bg-[#f8faf8] p-2.5 rounded-xl border border-slate-100">
                  <div className="w-8 h-8 rounded-full bg-[#eaf5ec] flex items-center justify-center shrink-0 text-[#166534] mt-0.5">
                    <Target className="w-4 h-4 stroke-[#166534] stroke-[2.2]" />
                  </div>
                  <div className="text-left flex-1">
                    <h4 className="text-[13.5px] font-bold text-slate-900">
                      Location Accuracy (Recommended)
                    </h4>
                    <p className="text-[11px] sm:text-[11.5px] text-slate-600 leading-relaxed mt-0.5">
                      Provides accurate location to show safe routes, danger zones, and community alerts in real time using device sensors.
                    </p>
                  </div>
                </div>
              </div>

              {/* Divider & You're in control section */}
              <div className="border-t border-slate-100 pt-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#eaf5ec] flex items-center justify-center shrink-0 text-[#166534] mt-0.5 border border-[#166534]/15">
                    <ShieldCheck className="w-4 h-4 stroke-[#166534] stroke-[2.2]" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-[12.5px] font-bold text-[#166534]">
                      You're in control.
                    </p>
                    <p className="text-[11.5px] text-slate-600 leading-normal mt-0.5">
                      You can change this anytime in your device location settings.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onDismiss}
                  className="px-4 py-2 rounded-full text-[13px] font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 active:scale-95 transition cursor-pointer"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={onTurnOn}
                  className="px-5 py-2 rounded-full text-[13px] font-semibold bg-[#166534] hover:bg-[#14532d] text-white flex items-center gap-1.5 active:scale-95 transition shadow-sm cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 fill-white/20 stroke-white stroke-[2]" />
                  <span>Allow location</span>
                </button>
              </div>

            </div>

            {/* BOTTOM FOOTER BRANDING BANNER */}
            <div className="bg-[#edf5ee] border-t border-[#dcefe0] px-4 py-2.5 flex items-center justify-between gap-2.5 text-left">
              <div className="flex items-center gap-2">
                <SafeRouteShieldLogo className="w-5 h-6" />
                <div>
                  <p className="text-[12px] font-bold text-[#166534] leading-tight">
                    SafeRoute Lite
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Safer routes. Safer you.
                  </p>
                </div>
              </div>

              <div className="bg-[#dcefe0] text-[#166534] px-2.5 py-1 rounded-lg flex items-center gap-1.5 border border-[#c4e5cb]">
                <Lock className="w-3 h-3 shrink-0 text-[#166534]" />
                <p className="text-[9.5px] font-medium text-slate-800 leading-tight">
                  Used only for safety.
                </p>
              </div>
            </div>

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
