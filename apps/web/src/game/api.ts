/**
 * HEIRLOOM — API client.
 *
 * This file is the entire surface through which the game changes. Part E of the
 * prototype — plant, harvest, breed, sell, commissions — was local simulation
 * and has been binned; each of those is now one call from here.
 *
 * Note what the client sends: ids and quantities. Never genes, never a
 * timestamp, never an outcome.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'heirloom.session';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, body.error ?? 'error', body.message ?? 'Something went wrong.');
  }
  return body as T;
}

const post = <T>(path: string, payload?: unknown) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(payload ?? {}) });

/* ---------------- types ---------------- */

export interface StrainView {
  id: string;
  accession: string;
  species: string;
  genes: Record<'Y' | 'V' | 'H' | 'E', [number, number]>;
  color: [string, string];
  name: string;
  named: boolean;
  generation: number;
  qty: number;
  pressed: boolean;
  parentAId: string | null;
  parentBId: string | null;
  mutations: Array<{ locus: string; from: string | number; to: string | number }>;
  createdAt: string;
  phenotype: { Y: number; V: number; H: number; E: number; color: string };
  score: number;
  tier: string;
  traits: string[];
  growSeconds: number;
  yieldCount: number;
  unitValue: number;
  blightChance: number;
}

export interface BedView {
  index: number;
  locked: boolean;
  strainId: string | null;
  plantedAt: string | null;
  ripeAt: string | null;
  growth: number;
  ripe: boolean;
  blighted: boolean | null;
}

export interface CommissionView {
  id: string;
  collector: string;
  note: string;
  species: string;
  reqs: Array<{ k: string; min?: number; color?: string }>;
  spec: string;
  coins: number;
  xp: number;
  seedReward: string;
  status: string;
  createdAt: string;
}

export interface StateSnapshot {
  player: {
    id: string;
    wallet: string;
    displayName: string | null;
    coins: number;
    seedBalance: string;
    xp: number;
    level: number;
    xpInLevel: number;
    xpForLevel: number;
    rep: number;
    repSlots: number;
    mutagen: number;
    plotCapacity: number;
  };
  beds: BedView[];
  vault: StrainView[];
  herbarium: StrainView[];
  produce: Array<{ species: string; color: string; qty: number; unitValue: number }>;
  commissions: CommissionView[];
  serverTime: string;
}

/* ---------------- auth ---------------- */

export const requestNonce = (wallet: string) =>
  post<{ nonce: string; message: string; expiresAt: string }>('/api/auth/nonce', { wallet });

export const verifySignature = (wallet: string, nonce: string, signature: string) =>
  post<{ token: string; playerId: string; wallet: string }>('/api/auth/verify', {
    wallet,
    nonce,
    signature,
  });

/* ---------------- game ---------------- */

export const fetchState = () => call<StateSnapshot>('/api/state');

export const plant = (bedIndex: number, strainId: string) =>
  post<StateSnapshot>('/api/plant', { bedIndex, strainId });

export interface HarvestResult {
  units: number;
  value: number;
  color: string;
  blighted: boolean;
  copies: number;
  xp: number;
  levelledUp: boolean;
  state: StateSnapshot;
}
export const harvest = (bedIndex: number) => post<HarvestResult>('/api/harvest', { bedIndex });

export interface SellResult {
  coins: number;
  qty: number;
  unitValue: number;
  xp: number;
  state: StateSnapshot;
}
export const sell = (species: string, color: string, qty?: number) =>
  post<SellResult>('/api/sell', { species, color, ...(qty ? { qty } : {}) });

export const buySeed = (species: string) =>
  post<{ strain: StrainView; state: StateSnapshot }>('/api/buy-seed', { species });

export const buyMutagen = () => post<StateSnapshot>('/api/buy-mutagen');

/**
 * The money endpoint. There is no preview and no retry: the response carries
 * the child the server already committed.
 */
export const breed = (parentAId: string, parentBId: string, useMutagen: boolean) =>
  post<{ child: StrainView; state: StateSnapshot }>('/api/breed', {
    parentAId,
    parentBId,
    useMutagen,
  });

export const nameStrain = (strainId: string, name: string) =>
  post<{ strain: StrainView; state: StateSnapshot }>('/api/strain/name', { strainId, name });

export interface FulfilResult {
  coins: number;
  seed: string;
  rep: number;
  xp: number;
  collector: string;
  state: StateSnapshot;
}
export const fulfilCommission = (commissionId: string, strainId: string) =>
  post<FulfilResult>('/api/commission/fulfil', { commissionId, strainId });

export const declineCommission = (commissionId: string) =>
  post<StateSnapshot>('/api/commission/decline', { commissionId });
