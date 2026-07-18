export type Practice =
  | "AI Engineering"
  | "Digital Platforms"
  | "Cybersecurity"
  | "Cloud"
  | "Multiple / Not sure yet";

export type Status = "new" | "reviewing" | "quoted" | "won" | "lost";

export interface Estimate {
  low: number;
  expected: number;
  high: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
  breakdown: {
    practice: string;
    day_rate: number;
    scope_days: number;
    timeline_factor: number;
    complexity_factor: number;
    source: string;
  };
}

export interface Note {
  id: string;
  inquiry_id: string;
  created_at: string;
  body: string;
  remind_at: string | null;
}

export interface Inquiry {
  id: string;
  ref: string;
  created_at: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  practice: string;
  budget: string;
  timeline: string;
  source: string;
  details: string;
  channel: "form" | "reges";
  status: Status;
  ai_low: number;
  ai_expected: number;
  ai_high: number;
  ai_confidence: string;
  ai_rationale: string;
  ai_breakdown: Estimate["breakdown"] | null;
  quote_amount: number | null;
  ip: string;
  notes: Note[];
}

export interface LeadInput {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  practice: string;
  budget?: string;
  timeline?: string;
  source?: string;
  details: string;
  channel?: "form" | "reges";
  website?: string; // honeypot
}
