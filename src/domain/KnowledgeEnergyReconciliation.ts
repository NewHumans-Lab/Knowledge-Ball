export type EnergyVerdict = 'CORRECT' | 'INCORRECT';
export type EnergySide = 'AGREE' | 'DISAGREE';

export interface EnergyPosition {
  key: string;
  side: EnergySide;
}

export interface PositionEntitlement {
  key: string;
  payoutAtoms: bigint;
}

export const ENERGY_ATOMS_PER_UNIT = 1_000_000n;

function winnerSide(verdict: EnergyVerdict): EnergySide {
  return verdict === 'CORRECT' ? 'AGREE' : 'DISAGREE';
}

/**
 * Replays the repository's equal-stake winner-pool formula exactly in atoms.
 * Every winning position receives its own stake plus an equal share of all
 * losing stakes. Integer remainder atoms are assigned by sorted position key.
 * Losing positions receive zero. If a side has no winner, all locked stake
 * remains in SYSTEM, matching the existing server settlement behavior.
 */
export function equalStakeEntitlements(
  positions: readonly EnergyPosition[],
  verdict: EnergyVerdict,
  stakeAtoms: bigint,
): PositionEntitlement[] {
  if (stakeAtoms <= 0n) throw new RangeError('stakeAtoms must be positive');
  const side = winnerSide(verdict);
  const winners = positions.filter(position => position.side === side).sort((a, b) => a.key.localeCompare(b.key));
  const losers = positions.length - winners.length;
  const winnerCount = BigInt(winners.length);
  const losingAtoms = BigInt(losers) * stakeAtoms;
  const share = winnerCount === 0n ? 0n : losingAtoms / winnerCount;
  const remainder = winnerCount === 0n ? 0n : losingAtoms % winnerCount;
  const winnerPayout = new Map<string, bigint>();

  winners.forEach((winner, index) => {
    winnerPayout.set(
      winner.key,
      stakeAtoms + share + (BigInt(index) < remainder ? 1n : 0n),
    );
  });

  return positions
    .map(position => ({ key: position.key, payoutAtoms: winnerPayout.get(position.key) ?? 0n }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * V2 initial claims deliberately keep the creator/system wager separate from
 * the ordinary one-energy voter pool. The creator's funded position pays 2
 * energy only when the final claim is CORRECT; otherwise it pays zero.
 */
export function initialCreatorEntitlement(funded: boolean, verdict: EnergyVerdict): bigint {
  return funded && verdict === 'CORRECT' ? 2n * ENERGY_ATOMS_PER_UNIT : 0n;
}

export function initialOrdinaryVoteEntitlements(
  voteKeysBySide: ReadonlyArray<EnergyPosition>,
  verdict: EnergyVerdict,
): PositionEntitlement[] {
  return equalStakeEntitlements(voteKeysBySide, verdict, ENERGY_ATOMS_PER_UNIT);
}

/**
 * A V1 revalidation round includes the human initiator as an AGREE energy
 * position plus every ordinary ballot. All positions use the round stake.
 */
export function challengeEntitlements(
  initiatorKey: string,
  ordinaryPositions: readonly EnergyPosition[],
  verdict: EnergyVerdict,
  stakeAtoms: bigint,
): PositionEntitlement[] {
  return equalStakeEntitlements(
    [{ key: initiatorKey, side: 'AGREE' }, ...ordinaryPositions],
    verdict,
    stakeAtoms,
  );
}

export function reconciliationDeltaAtoms(
  desiredPayoutAtoms: bigint,
  originalPayoutAtoms: bigint,
  priorReconciliationDeltasAtoms: readonly bigint[] = [],
): bigint {
  const alreadyApplied = priorReconciliationDeltasAtoms.reduce(
    (total, delta) => total + delta,
    originalPayoutAtoms,
  );
  return desiredPayoutAtoms - alreadyApplied;
}
