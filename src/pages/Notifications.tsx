import React, { useState, useEffect } from 'react';
import { Bell, Info, AlertOctagon, CheckCircle, Trash2, Check } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/error-handler';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Notification } from '../types';
import { safeGetMillis } from '../lib/utils';

export default function Notifications() {
  const { user } = useAuth();
  const { darkMode } = useTheme();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    // Load active notifications live from Firestore
    const q = query(collection(db, 'notifications'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const liveNotifs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Notification));
      
      // Sort: unread first, then newest first
      liveNotifs.sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return safeGetMillis(b.createdAt) - safeGetMillis(a.createdAt);
      });

      setNotifications(liveNotifs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'notifications');
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  const markAllRead = async () => {
    if (!user || notifications.length === 0) return;
    try {
      const batch = writeBatch(db);
      notifications.forEach((notif) => {
        if (!notif.read) {
          const ref = doc(db, 'notifications', notif.id);
          batch.update(ref, { read: true });
        }
      });
      await batch.commit();
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const toggleReadStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'notifications', id), {
        read: !currentStatus
      });
    } catch (err) {
      console.error('Failed to update read status:', err);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (err) {
      console.error('Failed to clear notification:', err);
    }
  };

  const getIcon = (type: string) => {
    switch(type) {
      case 'alert':
      case 'danger': 
        return <AlertOctagon className="w-5 h-5 text-red-500" />;
      case 'check':
      case 'success': 
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      default: 
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  // Default mock alerts for pristine empty state presentation
  const defaultAlerts = [
    { id: 'def-1', title: 'Welcome to SafeRoute Lite', message: 'Join Barangay Palanan safety networks to protect yourself and family.', type: 'info', read: false, time: 'Now' },
    { id: 'def-2', title: 'GPS Alignment Active', message: 'Leaflet routing system configured for Palanan, Makati.', type: 'check', read: true, time: '1h ago' }
  ];

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center px-1">
        <div>
          <h1 className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>Safety Hub Alerts</h1>
          <p className={`text-xs font-medium ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Real-time threat notifications & alerts.</p>
        </div>
        {notifications.some(n => !n.read) && (
          <button 
            onClick={markAllRead}
            className={`text-xs font-extrabold uppercase hover:underline flex items-center gap-1 px-3 py-1.5 rounded-full ${
              darkMode ? 'bg-blue-900/40 text-blue-400' : 'bg-blue-50 text-blue-600'
            }`}
          >
            <Check className="w-3.5 h-3.5" /> All Read
          </button>
        )}
      </div>

      <div className="space-y-3">
        {/* Render real live alerts */}
        {notifications.map((notif) => (
          <div 
            key={notif.id} 
            className={`p-4 rounded-3xl border transition-all flex gap-4 ${
              notif.read 
                ? (darkMode ? 'bg-slate-900 border-slate-800 opacity-75' : 'bg-white border-slate-50 opacity-75') 
                : (darkMode ? 'bg-blue-950/40 border-blue-900/30 shadow-sm' : 'bg-blue-50/50 border-blue-100 shadow-sm')
            }`}
          >
            <button 
              onClick={() => toggleReadStatus(notif.id, notif.read)}
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 active:scale-95 transition-all ${
                darkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'
              }`}
            >
              {getIcon(notif.type)}
            </button>
            <div className="flex-1">
              <div className="flex justify-between items-start gap-2 mb-1">
                <span className={`font-black text-sm ${
                  notif.read 
                    ? (darkMode ? 'text-slate-400' : 'text-slate-700') 
                    : (darkMode ? 'text-slate-200' : 'text-slate-900')
                }`}>
                  {notif.type.toUpperCase()} ALERT
                </span>
                <span className="text-[9px] text-slate-400 font-bold uppercase whitespace-nowrap">
                  {notif.createdAt ? new Date(safeGetMillis(notif.createdAt)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Now'}
                </span>
              </div>
              <p className={`text-xs leading-relaxed font-semibold ${
                darkMode ? 'text-slate-300' : 'text-slate-600'
              }`}>{notif.message}</p>
            </div>
            
            <button 
              onClick={() => deleteNotification(notif.id)}
              className={`p-1 rounded-full transition-colors h-fit self-center ${
                darkMode ? 'hover:bg-slate-800 text-slate-500 hover:text-slate-300' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'
              }`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {/* Render default ones if Firestore is empty */}
        {notifications.length === 0 && (
          <div className="space-y-3">
            <p className="text-[10px] text-center font-bold tracking-wider text-slate-400 uppercase py-2">System Guides</p>
            {defaultAlerts.map((notif) => (
              <div 
                key={notif.id} 
                className={`p-4 rounded-3xl border flex gap-4 ${
                  notif.read 
                    ? (darkMode ? 'bg-slate-900 border-slate-850 opacity-75' : 'bg-white border-slate-50 opacity-75') 
                    : (darkMode ? 'bg-blue-950/40 border-blue-900/30 shadow-sm' : 'bg-blue-50/50 border-blue-100 shadow-sm')
                }`}
              >
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                  darkMode ? 'bg-slate-800' : 'bg-slate-100'
                }`}>
                  {notif.type === 'check' ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Info className="w-5 h-5 text-blue-500" />}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <span className={`font-extrabold text-sm ${
                      darkMode ? 'text-slate-200' : 'text-slate-850'
                    }`}>{notif.title}</span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase">{notif.time}</span>
                  </div>
                  <p className={`text-xs leading-relaxed font-medium ${
                    darkMode ? 'text-slate-400' : 'text-slate-500'
                  }`}>{notif.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
