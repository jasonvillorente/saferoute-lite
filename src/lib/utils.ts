import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeGetMillis(timestamp: any): number {
  if (!timestamp) return Date.now();
  if (typeof timestamp.toMillis === 'function') {
    return timestamp.toMillis();
  }
  if (typeof timestamp.seconds === 'number') {
    return timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000;
  }
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    const parsed = new Date(timestamp).getTime();
    return isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

