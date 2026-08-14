/** Immutable interpreter for KnowledgeTruthProtocol / ORIGINAL_DESIGN_V1. */
export const POLICY_VERSION = 'ORIGINAL_DESIGN_V1' as const;
export const ROUND_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
export const ATOMS_PER_ENERGY = 1_000_000n;
export const ACTIVE_BALANCE_FLOOR = -10n * ATOMS_PER_ENERGY;

export type Verdict = 'PENDING' | 'CORRECT' | 'INCORRECT';
export type Side = 'AGREE' | 'DISAGREE';
export type ScopeGate = 'GLOBAL' | 'LOCAL_10';
export const ACCURACY_GATES = [50, 60, 70, 80, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100] as const;

export interface EscalationPolicy {
  stake: bigint;
  scope: ScopeGate;
  accuracyGate?: number;
}

export function ordinaryVotesRequired(userSnapshot: number): number {
  if (!Number.isSafeInteger(userSnapshot) || userSnapshot < 0) throw new RangeError('userSnapshot must be a non-negative safe integer');
  return 2 ** Math.floor(Math.log10(Math.max(userSnapshot, 1)));
}

/** Next decimal 1..9 tier: 90 -> 100, 900 -> 1000. */
export function nextStakeTier(current: bigint): bigint {
  if (current < 10n) throw new RangeError('challenge stake tier must be at least 10');
  const magnitude = 10n ** BigInt(current.toString().length - 1);
  return current + magnitude;
}

/** Stage 0 and 1 are the two ungated 10-energy challenge rounds. */
export function challengePolicy(stage: number): EscalationPolicy {
  if (!Number.isSafeInteger(stage) || stage < 0) throw new RangeError('stage must be a non-negative safe integer');
  if (stage < 2) return { stake: 10n, scope: stage === 0 ? 'GLOBAL' : 'LOCAL_10' };
  const gatedIndex = stage - 2;
  const cycleLength = ACCURACY_GATES.length * 2;
  const tierIndex = Math.floor(gatedIndex / cycleLength);
  let stake = 10n;
  for (let i = 0; i < tierIndex; i++) stake = nextStakeTier(stake);
  const withinTier = gatedIndex % cycleLength;
  return {
    stake,
    accuracyGate: ACCURACY_GATES[Math.floor(withinTier / 2)],
    scope: withinTier % 2 === 0 ? 'GLOBAL' : 'LOCAL_10',
  };
}

export function sideForVerdict(verdict: Exclude<Verdict, 'PENDING'>): Side {
  return verdict === 'CORRECT' ? 'AGREE' : 'DISAGREE';
}

export function timeoutVerdict(
  current: Verdict,
  initiatorSide: Side,
  agreeOrdinary: number,
  disagreeOrdinary: number,
): { verdict: Verdict; tied: boolean } {
  const agree = agreeOrdinary + (initiatorSide === 'AGREE' ? 1 : 0);
  const disagree = disagreeOrdinary + (initiatorSide === 'DISAGREE' ? 1 : 0);
  if (agree === disagree) return { verdict: current, tied: true };
  return { verdict: agree > disagree ? 'CORRECT' : 'INCORRECT', tied: false };
}

export interface Position { claimVersionId: string; side: Side }
export function currentAccuracy(positions: readonly Position[], verdicts: ReadonlyMap<string, Verdict>) {
  const unique = new Map<string, Position>();
  for (const position of positions) unique.set(`${position.claimVersionId}\0${position.side}`, position);
  let attempts = 0;
  let wins = 0;
  for (const position of unique.values()) {
    const verdict = verdicts.get(position.claimVersionId);
    if (!verdict || verdict === 'PENDING') continue;
    attempts++;
    if (sideForVerdict(verdict) === position.side) wins++;
  }
  return { attempts, wins, accuracy: attempts === 0 ? undefined : wins / attempts };
}

export interface WeightedPosition { id: string; accountId: string; side: Side; stakeAtoms: bigint }
export interface Entitlement { positionId: string; accountId: string; amountAtoms: bigint }

/** Deterministic largest-remainder settlement; input order never changes rewards. */
export function settlementEntitlements(positions: readonly WeightedPosition[], verdict: Exclude<Verdict, 'PENDING'>): Entitlement[] {
  const winningSide = sideForVerdict(verdict);
  const winners = positions.filter(p => p.side === winningSide).sort((a, b) => a.id.localeCompare(b.id));
  const losingPool = positions.filter(p => p.side !== winningSide).reduce((sum, p) => sum + p.stakeAtoms, 0n);
  if (winners.length === 0) return [];
  const count = BigInt(winners.length);
  const share = losingPool / count;
  const remainder = losingPool % count;
  return winners.map((winner, index) => ({
    positionId: winner.id,
    accountId: winner.accountId,
    amountAtoms: winner.stakeAtoms + share + (BigInt(index) < remainder ? 1n : 0n),
  }));
}

export function canActivelyLock(availableAtoms: bigint, stakeAtoms: bigint): boolean {
  return stakeAtoms >= 0n && availableAtoms - stakeAtoms >= ACTIVE_BALANCE_FLOOR;
}
