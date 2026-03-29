const ADJECTIVES = [
    'Snarky', 'Grumpy', 'Pedantic', 'Nitpicky', 'Sassy',
    'Skeptical', 'Judgmental', 'Caffeinated', 'Dramatic', 'Unimpressed',
    'Bewildered', 'Overworked', 'Exasperated', 'Passive', 'Reluctant',
    'Eloquent', 'Impatient', 'Savage', 'Ruthless', 'Blunt',
    'Petty', 'Smug', 'Cranky', 'Weary', 'Deadpan',
    'Sardonic', 'Cynical', 'Jaded', 'Relentless', 'Merciless',
    'Tireless', 'Thorough', 'Prickly', 'Fussy', 'Withering',
    'Scathing', 'Sarcastic', 'Spirited', 'Feisty', 'Shameless',
];

const NOUNS = [
    'Remark', 'Critique', 'Observation', 'Objection', 'Grievance',
    'Nit', 'Retort', 'Hot-Take', 'Tangent', 'Rant',
    'Verdict', 'Complaint', 'Side-Eye', 'Eye-Roll', 'Feedback',
    'Roast', 'Sermon', 'Monologue', 'Soliloquy', 'Ding',
    'Quip', 'Zinger', 'Shade', 'Sigh', 'Gripe',
    'Burn', 'Rebuke', 'Tirade', 'Lecture', 'Snark',
    'Jab', 'Diss', 'Callout', 'Takedown', 'Comeback',
    'Clapback', 'Mic-Drop', 'Subtweet', 'Eyebrow', 'Scoff',
];

function randomItem<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomSuffix(length: number = 4): string {
    return Math.random().toString(36).substring(2, 2 + length);
}

export function generateThreadId(): string {
    return `${randomItem(ADJECTIVES)}-${randomItem(NOUNS)}-${randomSuffix()}`;
}

export function generateCommentId(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}
