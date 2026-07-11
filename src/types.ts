import { Timestamp } from 'firebase/firestore';

export type UserRole = 'resident' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Timestamp;
}

export type ReportStatus = 'pending' | 'approved' | 'rejected';

export interface Report {
  id: string;
  reporterId: string;
  location: {
    lat: number;
    lng: number;
  };
  description: string;
  status: ReportStatus;
  imageUrl?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DangerZone {
  id: string;
  location: {
    lat: number;
    lng: number;
  };
  radius: number;
  description: string;
  addedBy: string;
  createdAt: Timestamp;
  active: boolean;
  name?: string;
  riskLevel?: 'low' | 'moderate' | 'high' | 'critical';
  type?: 'marker' | 'circle' | 'polygon';
  polygonPoints?: [number, number][];
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: Timestamp;
}

export type PlaceCategory = 'home' | 'school' | 'work' | 'hospital' | 'store' | 'favorite' | 'custom';

export interface SavedPlace {
  id: string;
  userId: string;
  name: string;
  category: PlaceCategory;
  icon: string;
  location: {
    lat: number;
    lng: number;
  };
  address?: string;
  useCount: number;
  createdAt: Timestamp;
}

export function safeGetCoords(item: any): { lat: number; lng: number } | null {
  if (!item) return null;

  // 1. Try if item itself has direct latitude/longitude or lat/lng
  const directLat = item.latitude !== undefined ? item.latitude : (item.lat !== undefined ? item.lat : undefined);
  const directLng = item.longitude !== undefined ? item.longitude : (item.lng !== undefined ? item.lng : undefined);
  if (directLat !== undefined && directLng !== undefined) {
    const pLat = Number(directLat);
    const pLng = Number(directLng);
    if (!isNaN(pLat) && !isNaN(pLng)) {
      return { lat: pLat, lng: pLng };
    }
  }

  // 2. Try nested location property (e.g. standard object or GeoPoint)
  if (item.location && typeof item.location === 'object') {
    const loc = item.location;
    const lat = loc.latitude !== undefined ? loc.latitude : (loc.lat !== undefined ? loc.lat : undefined);
    const lng = loc.longitude !== undefined ? loc.longitude : (loc.lng !== undefined ? loc.lng : undefined);
    if (lat !== undefined && lng !== undefined) {
      const pLat = Number(lat);
      const pLng = Number(lng);
      if (!isNaN(pLat) && !isNaN(pLng)) {
        return { lat: pLat, lng: pLng };
      }
    }
  }

  // 3. Try other nested naming conventions like position, coordinates, coords
  const potentialKeys = ['coordinates', 'position', 'coords'];
  for (const key of potentialKeys) {
    if (item[key] && typeof item[key] === 'object') {
      const loc = item[key];
      const lat = loc.latitude !== undefined ? loc.latitude : (loc.lat !== undefined ? loc.lat : undefined);
      const lng = loc.longitude !== undefined ? loc.longitude : (loc.lng !== undefined ? loc.lng : undefined);
      if (lat !== undefined && lng !== undefined) {
        const pLat = Number(lat);
        const pLng = Number(lng);
        if (!isNaN(pLat) && !isNaN(pLng)) {
          return { lat: pLat, lng: pLng };
        }
      }
    }
  }

  return null;
}


