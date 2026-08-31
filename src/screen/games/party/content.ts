// Prompts and questions for the party games.
//
// All of this is written for Webii. The real games' prompt lists are their
// authors' creative work and are not reproduced here -- same principle this
// project applies to ROMs. These are originals in a similar spirit.

/** Quiplash-style prompts: a setup, funnier the more specific the answer. */
export const QUIP_PROMPTS: string[] = [
  "The worst possible thing to hear from your pilot",
  "A terrible name for a hospital",
  "The real reason the dinosaurs went extinct",
  "A rejected flavour of toothpaste",
  "What your dog is actually thinking about you",
  "The least convincing excuse for being late",
  "A terrible slogan for a funeral home",
  "The worst superpower to have at a wedding",
  "Something you should never say in a lift",
  "A bad name for a boat",
  "The most disappointing thing to find in a treasure chest",
  "What aliens will report back about humans",
  "A terrible theme for a children's party",
  "The worst possible fortune-cookie message",
  "Something a robot would say to seem more human",
  "A rejected Olympic sport",
  "The worst thing to whisper during a job interview",
  "A terrible name for a cat",
  "What the moon is hiding from us",
  "The worst possible gift for a new neighbour",
  "A bad first line for a wedding speech",
  "Something you would find in a wizard's bin",
  "The worst advice to give someone learning to drive",
  "A terrible name for a perfume",
  "What your phone would say if it could talk",
  "The least useful thing to bring on a desert island",
  "A rejected ice cream topping",
  "The worst possible catchphrase for a superhero",
  "Something a ghost would complain about",
  "A terrible name for a submarine",
];

/** The Last Lash: one prompt everyone answers, so it wants to be broad. */
export const LAST_LASH_PROMPTS: string[] = [
  "Write a warning label for the human body",
  "Name a holiday that should exist but doesn't",
  "Write the worst possible opening line of a novel",
  "Invent a terrible new word and define it",
  "Write a review of Earth as if it were a hotel",
];

/**
 * Fibbage-style questions: an odd but true fact with a blank. Players invent
 * a plausible lie for the blank, then try to spot the real answer.
 */
export interface TriviaQuestion {
  question: string;
  answer: string;
}

export const TRIVIA: TriviaQuestion[] = [
  { question: "A group of flamingos is officially called a ___.", answer: "flamboyance" },
  { question: "In 1994, a man in Ohio was arrested for stealing 200 ___.", answer: "garden gnomes" },
  { question: "The world record for the longest time spent hugging a ___ is over 24 hours.", answer: "tree" },
  { question: "Astronauts on the ISS are not allowed to eat ___ because of the crumbs.", answer: "bread" },
  { question: "A town in Norway installed a giant mirror so residents could see ___.", answer: "the sun" },
  { question: "The inventor of the Pringles can had his ashes buried in ___.", answer: "a Pringles can" },
  { question: "In Switzerland it is illegal to own only one ___.", answer: "guinea pig" },
  { question: "The first item ever sold on eBay was a broken ___.", answer: "laser pointer" },
  { question: "Competitors in the World ___ Championships are judged on style and endurance.", answer: "sauna" },
  { question: "A Japanese company sells a pillow shaped like a ___ for lonely commuters.", answer: "lap" },
  { question: "In 2016 a brewery made a beer flavoured with ___.", answer: "beard yeast" },
  { question: "The longest recorded flight of a ___ lasted 13 hours.", answer: "chicken" },
];

/** Fakin' It instructions: everyone gets one except the faker. */
export const FAKIN_TASKS: string[] = [
  "Raise your hand if you have ever broken a bone",
  "Point at the person most likely to survive a zombie film",
  "Hold up the number of pets you have ever owned",
  "Make the face you make when the wifi drops",
  "Point at whoever would be worst in an emergency",
  "Raise your hand if you can whistle",
  "Hold up the number of countries you have visited",
  "Point at the person who is most likely to be famous one day",
  "Make the sound of your favourite animal, quietly",
  "Raise your hand if you have ever fallen asleep in a cinema",
];

export function pickSome<T>(items: T[], count: number, random: () => number = Math.random): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return out;
}
