import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Shield, User, Mail, Lock, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import { syncResidentToAllCollections, promiseWithTimeout } from '../lib/syncHelper';

export default function Register() {
  const { loginAsGuest } = useAuth();
  const { darkMode } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConsoleTip, setShowConsoleTip] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setShowConsoleTip(false);
    try {
      // Race native account creation with a 4.5-second timeout to prevent infinite client UI lag
      const registerPromise = createUserWithEmailAndPassword(auth, email, password);
      const registerResult = await promiseWithTimeout(registerPromise, 4500, 'register-timeout-marker' as any);
      
      if (registerResult === 'register-timeout-marker') {
        throw new Error('register-timeout');
      }
      
      const { user } = registerResult;
      
      // Synchronize to all user/resident collections for Admin Portal mapping
      await syncResidentToAllCollections(user.uid, name, email);

      navigate('/');
    } catch (err: any) {
      console.warn('Firebase native register issue:', err.code || err.message);
      
      if (err.code === 'auth/weak-password') {
        setError('Password is too weak. Please use at least 6 characters.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('This email is already registered.');
      } else {
        setShowConsoleTip(true);
        setError('Native service unconfigured or timed out. Activating SafeRoute Sandbox Fallback...');
        
        // --- GRACEFUL SANDBOX FALLBACK ---
        const mockUid = `res_${Math.random().toString(36).substring(2, 9)}`;
        
        // Sync to all collections so they immediately display in the Admin Portal!
        await syncResidentToAllCollections(mockUid, name, email);
        
        // Create custom local session
        const guestSession = {
          user: {
            uid: mockUid,
            email: email,
            displayName: name,
            isAnonymous: true
          },
          profile: {
            uid: mockUid,
            name: name,
            email: email,
            role: "resident",
            createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }
          }
        };
        localStorage.setItem('safe_route_guest', JSON.stringify(guestSession));
        
        // Redirect and reload to active session
        setTimeout(() => {
          navigate('/');
          window.location.reload();
        }, 1200);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    setShowConsoleTip(false);
    try {
      const provider = new GoogleAuthProvider();
      const { user } = await signInWithPopup(auth, provider);
      
      const displayName = user.displayName || 'Resident';
      const userEmail = user.email || '';
      
      // Synchronize across all collections for Admin Portal
      await syncResidentToAllCollections(user.uid, displayName, userEmail);
      
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Google Sign-In failed');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className={`min-h-screen flex flex-col items-center justify-center p-6 max-w-md mx-auto transition-colors duration-300 ${
      darkMode ? 'bg-slate-950 text-white' : 'bg-white text-slate-900'
    }`}>
      <div className="text-center mb-10">
        <div className={`p-3 rounded-2xl shadow-lg w-fit mx-auto mb-6 ${
          darkMode ? 'bg-blue-600 shadow-slate-900/60' : 'bg-blue-600 shadow-blue-200'
        }`}>
          <Shield className="w-8 h-8 text-white" />
        </div>
        <h1 className={`text-3xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-slate-900'}`}>Create Account</h1>
        <p className={`${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Join your barangay safety network</p>
      </div>

      <div className="w-full">
        {error && (
          <div className={`text-sm p-4 rounded-2xl border mb-4 font-medium animate-in fade-in slide-in-from-top-2 ${
            darkMode ? 'bg-red-950/25 border-red-900/40 text-red-400' : 'bg-red-50 border-red-100 text-red-600'
          }`}>
            <div>{error}</div>
            {showConsoleTip && (
              <div className={`mt-3 pt-3 border-t text-[11px] space-y-2 ${darkMode ? 'border-red-950/50 text-red-350' : 'border-red-100 text-red-700'}`}>
                <p>🔒 <strong>Auto-Fallback Active:</strong> We have automatically registered your simulated profile locally and synced it to all Admin Portal collections so you can continue testing with zero interruption!</p>
                <p>To enable full native Email/Password signups in your Firebase backend, simply go to:</p>
                <a 
                  href="https://console.firebase.google.com/project/rare-wharf-1s7sz/authentication/providers" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className={`inline-flex items-center gap-1.5 font-bold ${darkMode ? 'text-blue-400 hover:underline' : 'text-blue-600 hover:underline'}`}
                >
                  Firebase Auth Providers Console <ExternalLink className="w-3" />
                </a>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleRegister} className="w-full space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full Name"
              className={`w-full border rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium ${
                darkMode ? 'bg-slate-900 border-slate-800 text-white placeholder:text-slate-500' : 'bg-slate-50 border-slate-100 text-slate-900 placeholder:text-slate-400'
              }`}
              required
            />
          </div>

          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email Address"
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create Password"
              className={`w-full border rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium ${
                darkMode ? 'bg-slate-900 border-slate-800 text-white placeholder:text-slate-500' : 'bg-slate-50 border-slate-100 text-slate-900 placeholder:text-slate-400'
              }`}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full bg-blue-600 text-white font-bold py-4 rounded-2xl shadow-lg hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 mt-4 ${
              darkMode ? 'shadow-slate-950/40' : 'shadow-blue-200'
            }`}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Register'}
          </button>
        </form>

        <div className="relative my-6 flex items-center justify-center">
          <div className={`absolute inset-0 border-t ${darkMode ? 'border-slate-800' : 'border-slate-100'}`} />
          <span className={`relative px-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
            darkMode ? 'bg-slate-950 text-slate-500' : 'bg-white text-slate-400'
          }`}>Or</span>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className={`w-full font-bold py-4 rounded-2xl shadow-sm active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2.5 border ${
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
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.18 1 12s.43 3.45 1.18 4.94l3.66-2.85z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>

        <button
          type="button"
          onClick={loginAsGuest}
          disabled={loading}
          className={`w-full mt-3 font-bold py-4 rounded-2xl shadow-sm active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 ${
            darkMode ? 'bg-slate-800 text-slate-100 hover:bg-slate-700' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
          }`}
        >
          <Sparkles className="w-5 h-5 text-amber-500 fill-amber-500" />
          Enter as Guest (Demo Mode)
        </button>
      </div>

      <div className="mt-8 text-center">
        <p className={`text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          Already have an account?{' '}
          <Link to="/login" className="text-blue-500 hover:text-blue-400 font-bold">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
