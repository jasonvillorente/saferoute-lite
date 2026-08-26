import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Shield, Mail, Lock, Loader2, Sparkles, UserCheck } from 'lucide-react';
import { syncResidentToAllCollections, promiseWithTimeout } from '../lib/syncHelper';

export default function Login() {
  const { loginAsGuest } = useAuth();
  const { darkMode } = useTheme();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successInfo, setSuccessInfo] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setError('Please enter your email or phone number and password.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessInfo('');

    const rawInput = identifier.trim();
    const isEmail = rawInput.includes('@');

    let cleanEmail = '';
    let cleanPhone = '';

    if (isEmail) {
      cleanEmail = rawInput.toLowerCase();
    } else {
      let digits = rawInput.replace(/[^0-9]/g, '');
      if (digits.startsWith('0')) digits = digits.substring(1);
      cleanPhone = rawInput.startsWith('+') ? rawInput : (digits.length === 10 ? `+63${digits}` : rawInput);
      cleanEmail = `${digits}@phone.saferoute.ph`;
    }

    try {
      // 1. Try Firebase Native Auth
      const authPromise = signInWithEmailAndPassword(auth, cleanEmail, password);
      const authResult = await promiseWithTimeout(authPromise, 3800, 'auth-timeout-marker' as any);

      if (authResult !== 'auth-timeout-marker' && auth.currentUser) {
        const nameClean = auth.currentUser.displayName || (isEmail ? cleanEmail.split('@')[0] : `Resident (${cleanPhone || rawInput})`);
        await syncResidentToAllCollections(
          auth.currentUser.uid,
          nameClean,
          cleanEmail,
          cleanPhone || undefined,
          isEmail ? 'email' : 'phone'
        );
        navigate('/');
        return;
      }

      throw new Error('auth-timeout');
    } catch (err: any) {
      console.warn('Native sign-in fallback check:', err.message);

      // 2. Query Firestore / Backend for existing resident profile
      try {
        let matchedData: any = null;
        let mockUid = '';

        // Check backend lookup API first
        try {
          const res = await fetch('/api/lookup-resident', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: rawInput })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.found) {
              matchedData = data;
              mockUid = data.uid;
            }
          }
        } catch (e) {}

        // Fallback to client Firestore query
        if (!matchedData && db) {
          const usersRef = collection(db, 'users');
          if (isEmail) {
            const q = query(usersRef, where('email', '==', cleanEmail), limit(1));
            const snap = await promiseWithTimeout(getDocs(q), 2500, null);
            if (snap && !snap.empty) {
              matchedData = snap.docs[0].data();
              mockUid = snap.docs[0].id;
            }
          } else {
            const qPhone = query(usersRef, where('phoneNumber', '==', cleanPhone), limit(1));
            const snapPhone = await promiseWithTimeout(getDocs(qPhone), 2500, null);
            if (snapPhone && !snapPhone.empty) {
              matchedData = snapPhone.docs[0].data();
              mockUid = snapPhone.docs[0].id;
            }
          }
        }

        if (matchedData) {
          const simulatedName = matchedData.name || (isEmail ? cleanEmail.split('@')[0] : `Resident (${cleanPhone || rawInput})`);
          setSuccessInfo('Resident profile verified. Signing in...');

          const session = {
            user: {
              uid: mockUid,
              email: cleanEmail,
              phoneNumber: matchedData.phoneNumber || cleanPhone || '',
              displayName: simulatedName,
              isAnonymous: true
            },
            profile: {
              uid: mockUid,
              name: simulatedName,
              email: cleanEmail,
              phoneNumber: matchedData.phoneNumber || cleanPhone || '',
              phone: matchedData.phoneNumber || cleanPhone || '',
              mobileNumber: matchedData.mobileNumber || matchedData.phoneNumber || cleanPhone || '',
              authMethod: matchedData.authMethod || (isEmail ? 'email' : 'phone'),
              authProvider: matchedData.authProvider || matchedData.authMethod || (isEmail ? 'email' : 'phone'),
              provider: matchedData.provider || matchedData.authMethod || (isEmail ? 'email' : 'phone'),
              authType: matchedData.authType || matchedData.authMethod || (isEmail ? 'email' : 'phone'),
              isPhoneAuth: matchedData.isPhoneAuth !== undefined ? matchedData.isPhoneAuth : !isEmail,
              phoneBridgeEmail: !isEmail ? cleanEmail : undefined,
              role: matchedData.role || "resident",
              createdAt: matchedData.createdAt || { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }
            }
          };

          localStorage.setItem('safe_route_guest', JSON.stringify(session));

          setTimeout(() => {
            navigate('/');
            window.location.reload();
          }, 800);
        } else {
          setError('No account found with this email or phone number. Please register your account first.');
        }
      } catch (innerErr: any) {
        setError('Unable to log in. Please check your credentials or register a new account.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const displayName = user.displayName || 'Google User';
      const userEmail = user.email || '';
      
      await syncResidentToAllCollections(user.uid, displayName, userEmail, user.phoneNumber || undefined, 'google');
      navigate('/');
    } catch (err: any) {
      console.warn('Google sign-in error:', err.message);
      setError('Google Sign-In was cancelled or unavailable.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center p-6 max-w-md mx-auto transition-colors duration-300 ${
      darkMode ? 'bg-slate-950 text-white' : 'bg-white text-slate-900'
    }`}>
      {/* SafeRoute Brand Header */}
      <div className={`p-4 rounded-3xl shadow-xl mb-8 ${
        darkMode ? 'bg-blue-600 shadow-slate-900/60' : 'bg-blue-600 shadow-blue-200'
      }`}>
        <Shield className="w-12 h-12 text-white" />
      </div>
      
      <div className="text-center mb-8">
        <h1 className={`text-3xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-slate-900'}`}>SafeRoute Lite</h1>
        <p className={`${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Your community safety companion</p>
      </div>

      <div className="w-full">
        {error && (
          <div className={`text-sm p-4 rounded-2xl border mb-6 font-medium ${
            darkMode ? 'bg-red-950/30 border-red-900/40 text-red-300' : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {error}
          </div>
        )}

        {successInfo && (
          <div className={`text-sm p-4 rounded-2xl border mb-6 font-medium flex items-center gap-2 ${
            darkMode ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            <UserCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{successInfo}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="w-full space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              id="login-identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Email or phone number"
              className={`w-full border rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium ${
                darkMode ? 'bg-slate-900 border-slate-800 text-white placeholder:text-slate-500' : 'bg-slate-50 border-slate-100 text-slate-900 placeholder:text-slate-400'
              }`}
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="password"
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={`w-full border rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium ${
                darkMode ? 'bg-slate-900 border-slate-800 text-white placeholder:text-slate-500' : 'bg-slate-50 border-slate-100 text-slate-900 placeholder:text-slate-400'
              }`}
              required
            />
          </div>

          <button
            type="submit"
            id="login-submit-btn"
            disabled={loading}
            className={`w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 cursor-pointer ${
              darkMode ? 'shadow-slate-950/40' : 'shadow-blue-200'
            }`}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign In'}
          </button>
        </form>

        <div className="relative my-6 flex items-center justify-center">
          <div className={`absolute inset-0 border-t ${darkMode ? 'border-slate-800' : 'border-slate-100'}`} />
          <span className={`relative px-4 text-xs font-bold uppercase tracking-wider ${
            darkMode ? 'bg-slate-950 text-slate-500' : 'bg-white text-slate-400'
          }`}>Or continue with</span>
        </div>

        <button
          type="button"
          id="google-login-btn"
          onClick={handleGoogleLogin}
          disabled={loading}
          className={`w-full font-bold py-4 rounded-2xl shadow-xs active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2.5 border cursor-pointer ${
            darkMode ? 'bg-slate-900 border-slate-800 text-white hover:bg-slate-850' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Google
        </button>

        <button
          type="button"
          id="guest-login-btn"
          onClick={loginAsGuest}
          disabled={loading}
          className={`w-full mt-3 font-bold py-4 rounded-2xl shadow-xs active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 cursor-pointer ${
            darkMode ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
          }`}
        >
          <Sparkles className="w-5 h-5 text-amber-500 fill-amber-500" />
          Enter as Guest (Demo Mode)
        </button>
      </div>

      <div className="mt-8 text-center">
        <p className={`text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          Don't have an account?{' '}
          <Link to="/register" id="goto-register-link" className="text-blue-600 font-bold hover:underline">Register Now</Link>
        </p>
      </div>
    </div>
  );
}
