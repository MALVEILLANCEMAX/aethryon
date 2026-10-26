// Types du simulateur Stripe des essais (fake-stripe.mjs). Les objets simulés restent souples (any) : ce sont des
// copies partielles des objets de l'API Stripe.
import type { Server } from "node:http";

export interface FakeStripeState {
  offset: number;
  customers: Map<string, any>; sessions: Map<string, any>; subs: Map<string, any>; schedules: Map<string, any>;
  invoices: Map<string, any>; payments: Map<string, any>; charges: Map<string, any>; refunds: Map<string, any>;
  portals: Map<string, any>; events: any[]; idem: Map<string, { status: number; out: string }>;
  intents: Map<string, any>; disputes: Map<string, any>;
  calls: { method: string; path: string; idem: string | null; auth: boolean }[];
  down: boolean;
}

export interface FakeStripe {
  server: Server;
  state: FakeStripeState;
  simu: {
    /** `country` : pays de l'adresse de facturation (FR par défaut) ; `code` : code promo saisi sur la page. */
    complete(sessionId: string, opts?: { country?: string; code?: string }): any[];
    decline(sessionId: string): any[];
    patchSession(sessionId: string, patch: Record<string, unknown>): void;
    portalCancel(subId: string, cancel?: boolean): any[];
    endPeriod(subId: string): any[];
    failRenewal(subId: string): any[];
    unpaid(subId: string): any[];
    refundLatest(subId: string): any[];
    dispute(subId: string, status?: string, type?: string): any[];
    expire(sessionId: string): any[];
    refundPurchase(sessionId: string, amount?: number | null): any[];
    disputePurchase(sessionId: string, status?: string, type?: string): any[];
    advance(seconds: number): void;
  };
  emit(type: string, object: unknown): any;
  deliver(ev: unknown, opts?: { secret?: string; t?: number }): Promise<{ status: number; body: string } | null>;
  listen(port?: number, host?: string): Promise<number>;
  webhookUrl: string | null;
  close(): Promise<void>;
}

export function parseForm(text: string): Record<string, any>;
export const CHECKOUT_PARAMS: Set<string>;
export function checkoutParamError(b: Record<string, any>): string | null;
export function signature(payload: string, secret: string, t?: number): string;
export function createFakeStripe(opts: {
  publicBase?: string; webhookUrl?: string | null; webhookSecret?: string;
  prices?: Record<string, { id: string; amount: number; interval?: "year" | "month" }>;
  promotionCodes?: Record<string, { id: string; percent_off: number; duration: "once" | "forever" | "repeating" }>;
}): FakeStripe;
