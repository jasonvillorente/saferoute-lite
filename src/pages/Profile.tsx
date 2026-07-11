import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { User, Shield, Bell, Settings, ChevronRight, LogOut } from 'lucide-react';
import { auth } from '../lib/firebase';
import { cn } from '../lib/utils';

export default function Profile() {
  const { profile } = useAuth();
  const { darkMode } = useTheme();

  const sections = [
    { label: 'Security Settings', icon: Shield, color: 'text-orange-500' },
    { label: 'Notifications', icon: Bell, color: 'text-purple-500' },
    { label: 'General Settings', icon: Settings, color: 'text-slate-500' },
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

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
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
        )}>{profile?.name}</h1>
        <p className="text-slate-500 text-sm mb-4">{profile?.email}</p>
        <div className={cn(
          "inline-block px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors",
          darkMode ? "bg-slate-900 text-blue-400 border border-slate-800" : "bg-blue-50 text-blue-600"
        )}>
          Resident Profile
        </div>
      </div>

      <div className="space-y-3">
        {sections.map((section) => (
          <button 
            key={section.label}
            className={cn(
              "w-full p-4 rounded-2xl flex items-center justify-between border shadow-sm active:scale-[0.99] transition-all duration-300",
              darkMode 
                ? "bg-slate-900 border-slate-850 hover:bg-slate-800/80" 
                : "bg-white border-slate-100 hover:bg-slate-50"
            )}
          >
            <div className="flex items-center gap-4">
              <div className={cn(
                "p-2 rounded-xl transition-colors",
                darkMode ? "bg-slate-950" : "bg-slate-50"
              )}>
                <section.icon className={`w-5 h-5 ${section.color}`} />
              </div>
              <span className={cn(
                "font-semibold text-sm transition-colors",
                darkMode ? "text-slate-200" : "text-slate-700"
              )}>{section.label}</span>
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

      <div className="text-center pt-4">
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[2px]">SafeRoute Lite v1.0.0</p>
        <p className="text-[9px] text-slate-500 mt-1">Ref 2026-CAPSTONE-BARANGAY</p>
      </div>
    </div>
  );
}
