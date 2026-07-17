export const AUTO_RECAP_AWAY_MS = 3 * 60 * 1_000;
export const AUTO_RECAP_MIN_USER_TURNS = 3;

export function automaticRecapEligible(input: {
  awayMs: number;
  userIDs: string[];
  lastAutomaticUserID?: string;
}) {
  const latest = input.userIDs.at(-1);
  return (
    input.awayMs >= AUTO_RECAP_AWAY_MS &&
    input.userIDs.length >= AUTO_RECAP_MIN_USER_TURNS &&
    latest !== input.lastAutomaticUserID
  );
}
