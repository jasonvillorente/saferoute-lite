import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';
import { syncResidentToAllCollections } from '../lib/syncHelper';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  loginAsGuest: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if there's an active local guest session
    const guestDataStr = localStorage.getItem('safe_route_guest');
    if (guestDataStr) {
      try {
        const guestSession = JSON.parse(guestDataStr);
        setUser(guestSession.user as any);
        setProfile(guestSession.profile as any);
        setLoading(false);
        return;
      } catch (err) {
        localStorage.removeItem('safe_route_guest');
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const fallbackName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Resident';
        const fallbackEmail = firebaseUser.email || '';
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setProfile({ uid: firebaseUser.uid, ...userDoc.data() } as UserProfile);
          } else {
            // Self-healing: create in Firestore and save state
            console.log(`Self-healing: User authenticated but document missing. Syncing profile for ${fallbackEmail}...`);
            await syncResidentToAllCollections(firebaseUser.uid, fallbackName, fallbackEmail);
            setProfile({
              uid: firebaseUser.uid,
              name: fallbackName,
              email: fallbackEmail,
              role: 'resident',
              createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any
            });
          }
        } catch (e) {
          console.warn('Profile sync warning during login state check:', e);
          // Try to sync anyway to ensure users collection receives it
          try {
            await syncResidentToAllCollections(firebaseUser.uid, fallbackName, fallbackEmail);
          } catch (syncErr) {
            console.error('Self-healing background sync failed:', syncErr);
          }
          setProfile({
            uid: firebaseUser.uid,
            name: fallbackName,
            email: fallbackEmail,
            role: 'resident',
            createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any
          });
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const isAdmin = profile?.role === 'admin';

  const loginAsGuest = () => {
    const guestSession = {
      user: {
        uid: "guest-palanan-user",
        email: "guest@commuter.com",
        displayName: "Guest Resident",
        isAnonymous: true
      },
      profile: {
        uid: "guest-palanan-user",
        name: "Guest Resident",
        email: "guest@commuter.com",
        role: "resident",
        createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }
      }
    };
    localStorage.setItem('safe_route_guest', JSON.stringify(guestSession));
    setUser(guestSession.user as any);
    setProfile(guestSession.profile as any);
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, loginAsGuest }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
