import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Home, Map, ShieldAlert, User, Bell, LogOut, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { auth } from '../lib/firebase';
import { cn } from '../lib/utils';

export default function Layout() {
  const navigate = useNavigate();
  const { darkMode, toggleDarkMode } = useTheme();

  const handleLogout = async () => {
    localStorage.removeItem('safe_route_guest');
    await auth.signOut();
    navigate('/login');
  };

  const navItems = [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/map', icon: Map, label: 'Map' },
    { to: '/report', icon: ShieldAlert, label: 'Report' },
    { to: '/notifications', icon: Bell, label: 'Alerts' },
    { to: '/profile', icon: User, label: 'Profile' },
  ];

  return (
    <div className={cn(
      "min-h-screen flex flex-col max-w-md mx-auto relative shadow-xl overflow-hidden transition-colors duration-300",
      darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-800"
    )}>
      {/* Header */}
      <header className={cn(
        "px-4 py-3 border-b flex justify-between items-center sticky top-0 z-40 transition-colors duration-300",
        darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
      )}>
        <span className={cn(
          "font-bold tracking-tight",
          darkMode ? "text-white" : "text-slate-900"
        )}>
          SafeRoute Lite
        </span>
        <div className="flex items-center gap-2">
          {/* Global Theme Toggle Button */}
          <button 
            onClick={toggleDarkMode}
            className={cn(
              "p-1.5 rounded-full transition-all active:scale-95",
              darkMode ? "hover:bg-slate-850 text-yellow-400" : "hover:bg-slate-100 text-blue-600"
            )}
            title="Toggle Theme"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          <button 
            onClick={handleLogout}
            className={cn(
              "p-1.5 rounded-full transition-colors",
              darkMode ? "hover:bg-slate-850 text-slate-400 hover:text-slate-200" : "hover:bg-slate-100 text-slate-500"
            )}
            title="Sign Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative flex flex-col overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto pb-20 pt-4 px-4 scrollbar-hide">
          <Outlet />
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className={cn(
        "fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md border-t px-2 py-3 z-50 transition-colors duration-300",
        darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
      )}>
        <div className="flex justify-around items-end">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-1 transition-colors",
                  isActive 
                    ? (darkMode ? "text-blue-400" : "text-blue-600") 
                    : (darkMode ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600")
                )
              }
            >
              <item.icon className="w-6 h-6" />
              <span className="text-[10px] font-medium uppercase tracking-wider">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
