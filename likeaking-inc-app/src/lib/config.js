/**
 * Rate card + site config. The estimate engine prices from RATES.
 * Ported from the original backend/config.php + ai.php.
 */
const RATES = {
  day_rate: {
    'AI Engineering': 1650,
    'Digital Platforms': 1400,
    Cybersecurity: 1550,
    Cloud: 1450,
    default: 1450,
  },
  scope_days: {
    'Under $10k': 5,
    '$10k – $50k': 18,
    '$50k – $150k': 45,
    '$150k+': 80,
    'To be discussed': 15,
    default: 15,
  },
  timeline_factor: {
    'Immediate (< 1 month)': 1.25,
    'This quarter (1–3 months)': 1.0,
    '6+ months': 0.92,
    Exploratory: 0.9,
    default: 1.0,
  },
  range_spread: 0.22,
}

// service label (from the form) -> rate-card practice key
const PRACTICE_KEY = {
  'Intelligent Systems & AI Engineering': 'AI Engineering',
  'Digital Platforms & Product Engineering': 'Digital Platforms',
  'Cybersecurity & Risk Management': 'Cybersecurity',
  'Cloud Infrastructure & Managed Services': 'Cloud',
  'Multiple / Not sure yet': 'default',
}

const SITE = {
  name: 'Like a King Inc.',
  email: process.env.MAIL_FROM_EMAIL || 'info@likeaking.pro',
}

module.exports = { RATES, PRACTICE_KEY, SITE }
