/**
 * Rate card — the ground truth REGES prices from. Ported from the original
 * backend/config.php. Tune these numbers; they ARE the pricing schema.
 */
export const RATES = {
  day_rate: {
    "AI Engineering": 1650,
    "Digital Platforms": 1400,
    Cybersecurity: 1550,
    Cloud: 1450,
    default: 1450,
  } as Record<string, number>,
  // Rough engagement size in consulting-days, keyed off the budget band picked.
  scope_days: {
    "Under $10k": 5,
    "$10k – $50k": 18,
    "$50k – $150k": 45,
    "$150k+": 80,
    "To be discussed": 15,
    default: 15,
  } as Record<string, number>,
  timeline_factor: {
    "Immediate (< 1 month)": 1.25, // rush premium
    "This quarter (1–3 months)": 1.0,
    "6+ months": 0.92,
    Exploratory: 0.9,
    default: 1.0,
  } as Record<string, number>,
  range_spread: 0.22, // low/high = expected ∓ 22%
};

/**
 * Maps the human-readable practice label the visitor picks on the form to the
 * short key the rate card uses.
 */
export const PRACTICE_KEY: Record<string, string> = {
  "Intelligent Systems & AI Engineering": "AI Engineering",
  "Digital Platforms & Product Engineering": "Digital Platforms",
  "Cybersecurity & Risk Management": "Cybersecurity",
  "Cloud Infrastructure & Managed Services": "Cloud",
  "Multiple / Not sure yet": "default",
};

export const BUDGET_OPTIONS = [
  "Under $10k",
  "$10k – $50k",
  "$50k – $150k",
  "$150k+",
  "To be discussed",
];

export const TIMELINE_OPTIONS = [
  "Immediate (< 1 month)",
  "This quarter (1–3 months)",
  "6+ months",
  "Exploratory",
];

export const SOURCE_OPTIONS = ["Referral", "Search", "LinkedIn", "Social", "Other"];

export const PRACTICE_OPTIONS = [
  "Intelligent Systems & AI Engineering",
  "Digital Platforms & Product Engineering",
  "Cybersecurity & Risk Management",
  "Cloud Infrastructure & Managed Services",
  "Multiple / Not sure yet",
];

export const SITE = {
  name: "Like a King Inc.",
  shortName: "Like a King",
  domain: "likeaking.pro",
  email: "info@likeaking.pro",
  tagline: "Professional Business Services",
};
