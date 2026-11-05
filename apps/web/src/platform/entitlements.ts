import { load, save } from './storage.ts';

export type Plan = 'free' | 'premium';

export interface Allowance {
  plan: Plan;
  /** Plays per day on this plan; `null` means unlimited. */
  limit: number | null;
  used: number;
  remaining: number | null;
  resetsAt: Date;
}

/**
 * Decides whether the player may start another game, in builds without a server.
 * With one, the API enforces the limit (see `api-backend.ts`).
 */
export interface EntitlementService {
  getAllowance(): Allowance;
  /** Spends one play. Returns false when the player is out of plays. */
  consumePlay(): boolean;
  /** Development stand-in for a subscription checkout. */
  setPlan(plan: Plan): void;
}

export const FREE_PLAYS_PER_DAY = 5;

interface UsageRecord {
  day: string;
  used: number;
}

const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, local time

function nextMidnight(): Date {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d;
}

export function createLocalEntitlements(defaultPlan: Plan = 'free'): EntitlementService {
  const usage = (): UsageRecord => {
    const u = load<UsageRecord>('usage', { day: today(), used: 0 });
    return u.day === today() ? u : { day: today(), used: 0 };
  };

  const getAllowance = (): Allowance => {
    const plan = load<Plan>('plan', defaultPlan);
    const limit = plan === 'premium' ? null : FREE_PLAYS_PER_DAY;
    const { used } = usage();
    return {
      plan,
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      resetsAt: nextMidnight(),
    };
  };

  return {
    getAllowance,
    consumePlay() {
      const allowance = getAllowance();
      if (allowance.remaining === 0) return false;
      const u = usage();
      save('usage', { day: u.day, used: u.used + 1 });
      return true;
    },
    setPlan(plan) {
      save('plan', plan);
    },
  };
}
