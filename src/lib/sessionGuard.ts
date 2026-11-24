import type { AppRoute, UserProfile } from '../types/taibah';

const ACTIVE_SESSION_KEY = 'taibah_active_session_v1';
const ACTIVE_PROFILE_SESSION_KEY = 'taibah_active_profile_session_v1';
const ACTIVE_ROUTE_SESSION_KEY = 'taibah_active_route_v1';
const POST_RESET_UNLOCK_KEY = 'taibah_post_reset_unlock_once';

export const EXPLICIT_SIGNOUT_EVENT = 'taibah:explicit-sign-out';

export interface ActiveSessionRecord {
  unlocked: true;
  uid: string;
  email: string;
  unlockedAt: number;
}

export function markActiveSessionUnlocked(uid?: string, email?: string): void {
  try {
    const record: ActiveSessionRecord = {
      unlocked: true,
      uid: (uid || '').trim(),
      email: (email || '').trim().toLowerCase(),
      unlockedAt: Date.now(),
    };
    window.sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(record));
  } catch {
    // ignore storage restrictions
  }
}

export function getActiveSessionRecord(): ActiveSessionRecord | null {
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveSessionRecord>;
    if (parsed && parsed.unlocked === true) {
      return {
        unlocked: true,
        uid: String(parsed.uid || ''),
        email: String(parsed.email || ''),
        unlockedAt: Number(parsed.unlockedAt) || Date.now(),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export function hasActiveSessionUnlocked(): boolean {
  if (getActiveSessionRecord()) return true;
  try {
    if (window.sessionStorage.getItem(POST_RESET_UNLOCK_KEY) === '1') {
      window.sessionStorage.removeItem(POST_RESET_UNLOCK_KEY);
      markActiveSessionUnlocked();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function saveActiveProfileToSession(profile: UserProfile | null): void {
  try {
    if (!profile) {
      window.sessionStorage.removeItem(ACTIVE_PROFILE_SESSION_KEY);
      return;
    }
    const { createdAt: _c, updatedAt: _u, ...serializable } = profile;
    window.sessionStorage.setItem(ACTIVE_PROFILE_SESSION_KEY, JSON.stringify(serializable));
  } catch {
    // ignore
  }
}

export function readActiveProfileFromSession(): UserProfile | null {
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_PROFILE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    if (parsed && parsed.uid && parsed.role) {
      return parsed as UserProfile;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveActiveRouteToSession(route: AppRoute): void {
  try {
    window.sessionStorage.setItem(ACTIVE_ROUTE_SESSION_KEY, route);
  } catch {
    // ignore
  }
}

export function readActiveRouteFromSession(): AppRoute | null {
  try {
    const val = window.sessionStorage.getItem(ACTIVE_ROUTE_SESSION_KEY);
    return (val as AppRoute) || null;
  } catch {
    return null;
  }
}

export function clearActiveSession(dispatchEvent = true): void {
  try {
    window.sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    window.sessionStorage.removeItem(ACTIVE_PROFILE_SESSION_KEY);
    window.sessionStorage.removeItem(ACTIVE_ROUTE_SESSION_KEY);
    window.sessionStorage.removeItem(POST_RESET_UNLOCK_KEY);
  } catch {
    // ignore
  }
  if (dispatchEvent && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(EXPLICIT_SIGNOUT_EVENT));
    } catch {
      // ignore
    }
  }
}
