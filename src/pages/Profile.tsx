import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { 
  User, 
  Shield, 
  Bell, 
  Settings, 
  ChevronRight, 
  LogOut, 
  ArrowLeft, 
  Volume2, 
  Compass, 
  Trash2, 
  CheckCircle2, 
  Sparkles, 
  Smartphone,
  ShieldCheck
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { cn } from '../lib/utils';
import SecuritySettingsView from '../components/SecuritySettingsView';

type ProfileView = 'main' | 'security' | 'notifications' | 'general';

export default function Profile() {
  const { profile, user } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const [currentView, setCurrentView] = useState<ProfileView>('main');
  const [notificationState, setNotificationState] = useState({
    sosAlerts: true,
    hazardAlerts: true,
    communitySpots: true,
    soundVibration: true,
  });
  const [generalState, setGeneralState] = useState({
    distanceUnit: 'km',
    voiceGuidance: true,
    highContrastMap: false,
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const sections = [
    { id: 'security' as ProfileView, label: 'Security Settings', icon: Shield, color: 'text-orange-500', desc: 'Password, Privacy, Login/2FA & Delete' },
    { id: 'notifications' as ProfileView, label: 'Notifications', icon: Bell, color: 'text-purple-500', desc: 'Emergency broadcast & hazard alerts' },
    { id: 'general' as ProfileView, label: 'General Settings', icon: Settings, color: 'text-slate-500', desc: 'Theme, distance units & audio cues' },
  ];

  const handleSignOut = async () => {
    localStorage.removeItem('safe_route_guest');
    try {
      await auth.signOut();
    } catch (e) {
      console.warn('Sign out error:', e);
    }
    window.location.href = '/login';
  };

  const handleClearCache = () => {
    localStorage.removeItem('saferoute_search_history');
    showToast('Navigation route cache & search history cleared.');
  };

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      {toastMessage && (
        <div className={cn(
          "fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl shadow-xl border flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-top-3",
          darkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-slate-200 text-slate-800"
        )}>
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* RENDER DEDICATED SECURITY SETTINGS VIEW */}
      {currentView === 'security' && (
        <SecuritySettingsView onBack={() => setCurrentView('main')} />
      )}

      {/* RENDER NOTIFICATIONS VIEW */}
      {currentView === 'notifications' && (
        <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setCurrentView('main')}
              className={cn(
                "p-2 rounded-xl border transition-colors active:scale-95",
                darkMode ? "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className={cn("text-xl font-bold", darkMode ? "text-white" : "text-slate-900")}>Notifications</h2>
              <p className="text-xs text-slate-500">Configure alert channels and push broadcasts</p>
            </div>
          </div>

          <div className="space-y-3">
            {[
              { key: 'sosAlerts', label: 'Emergency SOS Broadcasts', desc: 'Immediate siren alerts when nearby residents trigger distress' },
              { key: 'hazardAlerts', label: 'Barangay Hazard Updates', desc: 'Flooding, road blockages, and high-risk zone warnings' },
              { key: 'communitySpots', label: 'Community Spot Notifications', desc: 'Updates when new safe havens or spots are verified' },
              { key: 'soundVibration', label: 'Sound & Vibration Alerts', desc: 'Play audible alarm tone during critical safety alerts' },
            ].map((item) => (
              <div
                key={item.key}
                className={cn(
                  "p-4 rounded-2xl border flex items-center justify-between gap-3 shadow-xs",
                  darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
                )}
              >
                <div>
                  <span className={cn("text-sm font-bold block", darkMode ? "text-slate-100" : "text-slate-900")}>{item.label}</span>
                  <span className="text-xs text-slate-500 block mt-0.5">{item.desc}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...notificationState, [item.key]: !notificationState[item.key as keyof typeof notificationState] };
                    setNotificationState(next);
                    showToast('Notification preference updated.');
                  }}
                  className={cn(
                    "w-12 h-6.5 rounded-full p-0.5 transition-colors duration-200 flex items-center shrink-0",
                    notificationState[item.key as keyof typeof notificationState] ? "bg-purple-600 justify-end" : (darkMode ? "bg-slate-750 justify-start" : "bg-slate-300 justify-start")
                  )}
                >
                  <div className="w-5.5 h-5.5 rounded-full bg-white shadow-md" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RENDER GENERAL SETTINGS VIEW */}
      {currentView === 'general' && (
        <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="flex items-center gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setCurrentView('main')}
              className={cn(
                "p-2 rounded-xl border transition-colors active:scale-95",
                darkMode ? "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className={cn("text-xl font-bold", darkMode ? "text-white" : "text-slate-900")}>General Settings</h2>
              <p className="text-xs text-slate-500">App interface, navigation units, and cache controls</p>
            </div>
          </div>

          <div className="space-y-3">
            {/* Theme Toggle */}
            <div className={cn(
              "p-4 rounded-2xl border flex items-center justify-between gap-3 shadow-xs",
              darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
            )}>
              <div>
                <span className={cn("text-sm font-bold block", darkMode ? "text-slate-100" : "text-slate-900")}>Appearance Theme</span>
                <span className="text-xs text-slate-500 block mt-0.5">Toggle between Dark and Light mode</span>
              </div>
              <button
                type="button"
                onClick={toggleDarkMode}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-colors",
                  darkMode ? "bg-slate-800 border-slate-700 text-yellow-400" : "bg-slate-100 border-slate-200 text-slate-700"
                )}
              >
                {darkMode ? '🌙 Dark Mode' : '☀️ Light Mode'}
              </button>
            </div>

            {/* Distance Units */}
            <div className={cn(
              "p-4 rounded-2xl border flex items-center justify-between gap-3 shadow-xs",
              darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
            )}>
              <div>
                <span className={cn("text-sm font-bold block", darkMode ? "text-slate-100" : "text-slate-900")}>Distance Measurement</span>
                <span className="text-xs text-slate-500 block mt-0.5">Meters/Kilometers vs Feet/Miles</span>
              </div>
              <div className="flex rounded-xl p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setGeneralState(s => ({ ...s, distanceUnit: 'km' }))}
                  className={cn(
                    "px-3 py-1 text-xs font-bold rounded-lg transition-all",
                    generalState.distanceUnit === 'km' ? "bg-blue-600 text-white shadow-xs" : "text-slate-500"
                  )}
                >
                  Metric (km)
                </button>
                <button
                  type="button"
                  onClick={() => setGeneralState(s => ({ ...s, distanceUnit: 'mi' }))}
                  className={cn(
                    "px-3 py-1 text-xs font-bold rounded-lg transition-all",
                    generalState.distanceUnit === 'mi' ? "bg-blue-600 text-white shadow-xs" : "text-slate-500"
                  )}
                >
                  Imperial (mi)
                </button>
              </div>
            </div>

            {/* Audio Voice Cue */}
            <div className={cn(
              "p-4 rounded-2xl border flex items-center justify-between gap-3 shadow-xs",
              darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
            )}>
              <div>
                <span className={cn("text-sm font-bold block", darkMode ? "text-slate-100" : "text-slate-900")}>Audio Voice Prompts</span>
                <span className="text-xs text-slate-500 block mt-0.5">Spoken turn-by-turn guidance along safe illuminated paths</span>
              </div>
              <button
                type="button"
                onClick={() => setGeneralState(s => ({ ...s, voiceGuidance: !s.voiceGuidance }))}
                className={cn(
                  "w-12 h-6.5 rounded-full p-0.5 transition-colors duration-200 flex items-center shrink-0",
                  generalState.voiceGuidance ? "bg-blue-600 justify-end" : (darkMode ? "bg-slate-750 justify-start" : "bg-slate-300 justify-start")
                )}
              >
                <div className="w-5.5 h-5.5 rounded-full bg-white shadow-md" />
              </button>
            </div>

            {/* Clear Route Cache */}
            <div className={cn(
              "p-4 rounded-2xl border flex items-center justify-between gap-3 shadow-xs",
              darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
            )}>
              <div>
                <span className={cn("text-sm font-bold block", darkMode ? "text-slate-100" : "text-slate-900")}>Offline Route Cache</span>
                <span className="text-xs text-slate-500 block mt-0.5">Free local storage and reset saved temporary routes</span>
              </div>
              <button
                type="button"
                onClick={handleClearCache}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5",
                  darkMode ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750" : "bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200"
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Cache
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RENDER MAIN PROFILE MENU */}
      {currentView === 'main' && (
        <div className="space-y-6">
          <div className="text-center p-6 pb-2">
            <div className={cn(
              "w-24 h-24 rounded-full mx-auto mb-4 flex items-center justify-center border-4 shadow-xl transition-all duration-300",
              darkMode 
                ? "bg-slate-900 border-slate-800 shadow-slate-950/55" 
                : "bg-blue-100 border-white shadow-blue-100"
            )}>
              <User className={cn(
                "w-12 h-12 transition-colors",
                darkMode ? "text-blue-400" : "text-blue-600"
              )} />
            </div>
            <h1 className={cn(
              "text-2xl font-bold transition-colors",
              darkMode ? "text-white" : "text-slate-900"
            )}>{profile?.name || user?.displayName || 'Resident Profile'}</h1>
            <p className="text-slate-500 text-sm mb-4">{profile?.email || user?.email || 'resident@palanan.ph'}</p>
            <div className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors bg-blue-50 text-blue-600 dark:bg-slate-900 dark:text-blue-400 dark:border dark:border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
              Verified Resident Profile
            </div>
          </div>

          <div className="space-y-3">
            {sections.map((section) => (
              <button 
                key={section.id}
                onClick={() => setCurrentView(section.id)}
                className={cn(
                  "w-full p-4 rounded-2xl flex items-center justify-between border shadow-sm active:scale-[0.99] transition-all duration-300 text-left",
                  darkMode 
                    ? "bg-slate-900 border-slate-850 hover:bg-slate-800/80" 
                    : "bg-white border-slate-100 hover:bg-slate-50"
                )}
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "p-2.5 rounded-xl transition-colors",
                    darkMode ? "bg-slate-950" : "bg-slate-50"
                  )}>
                    <section.icon className={`w-5 h-5 ${section.color}`} />
                  </div>
                  <div>
                    <span className={cn(
                      "font-semibold text-sm block transition-colors",
                      darkMode ? "text-slate-200" : "text-slate-700"
                    )}>{section.label}</span>
                    <span className="text-xs text-slate-400 block mt-0.5">{section.desc}</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400" />
              </button>
            ))}
          </div>

          <button
            onClick={handleSignOut}
            className={cn(
              "w-full border-2 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all duration-300",
              darkMode 
                ? "bg-slate-900 border-red-950/40 text-red-400 hover:bg-red-950/20" 
                : "bg-white border-red-50 text-red-600 hover:bg-red-50"
            )}
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>

          <div className="text-center pt-2">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[2px]">SafeRoute Lite v1.0.0</p>
            <p className="text-[9px] text-slate-500 mt-1">Ref 2026-CAPSTONE-BARANGAY</p>
          </div>
        </div>
      )}
    </div>
  );
}

