// Shared logic for the write-and-vote party games. Pure, so prompt pairing
// and vote counting can be tested without a room full of phones.

/** One prompt handed to exactly two players, who answer it head to head. */
export interface Matchup {
  promptIndex: number;
  prompt: string;
  /** Player indexes, always two. */
  players: [number, number];
  answers: [string, string];
}

/**
 * Hand every player exactly two prompts, with every prompt going to exactly
 * two players.
 *
 * Player i gets prompts i and i+1, so prompt j is answered by players j and
 * j-1. That needs as many prompts as players and pairs everyone with each of
 * their two neighbours -- the same shape Quiplash uses, without needing to
 * search for a valid assignment.
 */
export function assignPrompts(playerCount: number, prompts: string[]): Matchup[] {
  if (playerCount < 3) throw new Error("needs at least three players");
  const used = prompts.slice(0, playerCount);
  return used.map((prompt, j) => ({
    promptIndex: j,
    prompt,
    players: [(j - 1 + playerCount) % playerCount, j] as [number, number],
    answers: ["", ""] as [string, string],
  }));
}

/** Which prompts a given player has to answer, in the order they see them. */
export function promptsFor(matchups: Matchup[], player: number): number[] {
  return matchups.filter((m) => m.players.includes(player)).map((m) => m.promptIndex);
}

export interface RoundScore {
  /** Points added to each player this round, indexed by player. */
  points: number[];
  /** Players who swept every vote on one of their answers. */
  quiplashed: number[];
  /** Prompts where both answers were identical, so neither scored. */
  jinxed: number[];
}

/**
 * Score one matchup. Points are the round multiplier times the share of
 * votes, so a bigger round is worth more without changing the shape of the
 * scoring. A clean sweep is worth a bonus; identical answers score nothing
 * for either player.
 */
export function scoreMatchup(
  matchup: Matchup,
  votes: Map<number, 0 | 1>,
  multiplier: number,
  eligibleVoters: number,
): { points: [number, number]; quiplash: -1 | 0 | 1; jinx: boolean } {
  const normalise = (text: string) => text.trim().toLowerCase();
  if (matchup.answers[0] && normalise(matchup.answers[0]) === normalise(matchup.answers[1])) {
    return { points: [0, 0], quiplash: -1, jinx: true };
  }

  let a = 0;
  let b = 0;
  for (const choice of votes.values()) {
    if (choice === 0) a += 1;
    else b += 1;
  }
  const cast = a + b;
  const per = 100 * multiplier;
  const points: [number, number] = [
    cast === 0 ? 0 : Math.round((a / cast) * per),
    cast === 0 ? 0 : Math.round((b / cast) * per),
  ];

  // A sweep only counts if everyone who could vote actually did.
  let quiplash: -1 | 0 | 1 = -1;
  if (eligibleVoters > 0 && cast === eligibleVoters) {
    if (a === cast) quiplash = 0;
    else if (b === cast) quiplash = 1;
  }
  // Written out rather than `>= 0` so the tuple index narrows to 0 | 1.
  if (quiplash === 0 || quiplash === 1) points[quiplash] += Math.round(per * 0.5);

  return { points, quiplash, jinx: false };
}

/** Everyone except the two players who wrote the answers. */
export function eligibleVoters(playerCount: number, matchup: Matchup): number[] {
  const out: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    if (!matchup.players.includes(i)) out.push(i);
  }
  return out;
}

/**
 * Tally a many-way vote (the Last Lash, or Fibbage's lie-picking): returns
 * how many votes each option received.
 */
export function countVotes(votes: Map<number, number>, optionCount: number): number[] {
  const counts = new Array(optionCount).fill(0);
  for (const choice of votes.values()) {
    if (choice >= 0 && choice < optionCount) counts[choice] += 1;
  }
  return counts;
}

/** Ranked standings, highest first, for the results screen. */
export function standings(points: number[]): { player: number; points: number }[] {
  return points
    .map((value, player) => ({ player, points: value }))
    .sort((a, b) => b.points - a.points);
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
