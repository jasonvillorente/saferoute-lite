import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile, UserRole } from '../types';
import { syncResidentToAllCollections } from '../lib/syncHelper';
import { isDemoMode as calculateDemoMode } from '../config/demo';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isDemoMode: boolean;
  loginAsGuest: () => void;
  signOut: () => Promise<void>;
  toggleUserRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Self-heal and migrate any local cached storage on initial load
  const loadLocalFallbackSession = () => {
    // 1. Check registered user storage first
    const registeredStr = localStorage.getItem('safe_route_registered_user');
    if (registeredStr) {
      try {
        const session = JSON.parse(registeredStr);
        if (session.user && session.profile) {
          setUser(session.user as any);
          setProfile(session.profile as any);
          setLoading(false);
          return true;
        }
      } catch (e) {
        localStorage.removeItem('safe_route_registered_user');
      }
    }

    // 2. Check guest storage
    const guestStr = localStorage.getItem('safe_route_guest');
    if (guestStr) {
      try {
        const session = JSON.parse(guestStr);
        const u = session.user;
        const p = session.profile;

        // Auto-heal: If safe_route_guest actually holds a registered account, migrate it!
        const email = String(u?.email || p?.email || '').toLowerCase();
        const uid = String(u?.uid || p?.uid || '').toLowerCase();
        const isActuallyGuest = 
          uid === 'guest-palanan-user' || 
          uid === 'guest' || 
          uid === 'demo-user' || 
          email === 'guest@commuter.com';

        if (!isActuallyGuest && (email || uid)) {
          console.log('Migrating mistakenly saved guest session to registered resident session...');
          localStorage.setItem('safe_route_registered_user', guestStr);
          localStorage.removeItem('safe_route_guest');
          setUser(u as any);
          setProfile(p as any);
          setLoading(false);
          return true;
        }

        // Legitimate guest session
        setUser(u as any);
        setProfile(p as any);
        setLoading(false);
        return true;
      } catch (err) {
        localStorage.removeItem('safe_route_guest');
      }
    }

    return false;
  };

  useEffect(() => {
    // Prime state with cached session while Firebase connects
    loadLocalFallbackSession();

    // Always subscribe to Firebase Auth state
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Authenticated with real Firebase Account -> Clear any guest markers!
        localStorage.removeItem('safe_route_guest');
        setUser(firebaseUser);

        const fallbackName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Resident';
        const fallbackEmail = firebaseUser.email || '';
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            const prof = { uid: firebaseUser.uid, ...data } as UserProfile;
            setProfile(prof);
            // Cache registered session
            localStorage.setItem('safe_route_registered_user', JSON.stringify({
              user: {
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: prof.name || fallbackName,
                isGuest: false
              },
              profile: prof
            }));
          } else {
            console.log(`Self-healing: User authenticated but document missing. Syncing profile for ${fallbackEmail}...`);
            await syncResidentToAllCollections(firebaseUser.uid, fallbackName, fallbackEmail);
            const prof: UserProfile = {
              uid: firebaseUser.uid,
              name: fallbackName,
              email: fallbackEmail,
              role: 'resident',
              createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any
            };
            setProfile(prof);
            localStorage.setItem('safe_route_registered_user', JSON.stringify({
              user: {
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: fallbackName,
                isGuest: false
              },
              profile: prof
            }));
          }
        } catch (e) {
          console.warn('Profile sync warning during login state check:', e);
          const prof: UserProfile = {
            uid: firebaseUser.uid,
            name: fallbackName,
            email: fallbackEmail,
            role: 'resident',
            createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any
          };
          setProfile(prof);
        }
        setLoading(false);
      } else {
        // Firebase has no active user.
        // Check if there is a local cached session (either registered or guest)
        const hasLocal = loadLocalFallbackSession();
        if (!hasLocal) {
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const isAdmin = profile?.role === 'admin';
  const isDemoMode = calculateDemoMode(user, profile);

  const toggleUserRole = async () => {
    if (!profile) return;
    const newRole: UserRole = profile.role === 'admin' ? 'resident' : 'admin';
    const updatedProfile: UserProfile = { ...profile, role: newRole };
    setProfile(updatedProfile);

    if (user && !user.isAnonymous && db) {
      try {
        await updateDoc(doc(db, 'users', user.uid), { role: newRole });
      } catch (e) {
        console.warn('Could not persist role in Firestore:', e);
      }
    } else {
      const regStr = localStorage.getItem('safe_route_registered_user');
      if (regStr) {
        try {
          const reg = JSON.parse(regStr);
          reg.profile.role = newRole;
          localStorage.setItem('safe_route_registered_user', JSON.stringify(reg));
        } catch (e) {}
      }
    }
  };

  const loginAsGuest = () => {
    // Clear any registered user markers
    localStorage.removeItem('safe_route_registered_user');

    const guestSession = {
      user: {
        uid: "guest-palanan-user",
        email: "guest@commuter.com",
        displayName: "Guest Resident",
        isAnonymous: true,
        isGuest: true
      },
      profile: {
        uid: "guest-palanan-user",
        name: "Guest Resident",
        email: "guest@commuter.com",
        role: "resident",
        isGuest: true,
        createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }
      }
    };
    localStorage.setItem('safe_route_guest', JSON.stringify(guestSession));
    setUser(guestSession.user as any);
    setProfile(guestSession.profile as any);
    window.location.href = '/';
  };

  const signOut = async () => {
    localStorage.removeItem('safe_route_guest');
    localStorage.removeItem('safe_route_registered_user');
    setUser(null);
    setProfile(null);
    try {
      await auth.signOut();
    } catch (e) {
      console.warn('Sign out error:', e);
    }
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      loading, 
      isAdmin, 
      isDemoMode,
      loginAsGuest, 
      signOut,
      toggleUserRole 
    }}>
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
