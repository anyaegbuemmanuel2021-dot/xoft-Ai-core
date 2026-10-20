const POSITIVE_SIGNALS = [
  ['budget', /\b(budget|paid|payment|rate|price|funded|contract)\b/i, 2],
  ['clear_scope', /\b(website|landing page|chatbot|automation|social media|advertising|design|video|seo)\b/i, 2],
  ['recent_or_urgent', /\b(today|urgent|asap|deadline|this week|posted recently)\b/i, 1],
  ['hiring_or_request', /\b(hiring|looking for|seeking|need a|freelancer|freelance|project|job|request for proposal)\b/i, 2],
];
const NEGATIVE_SIGNALS = [
  ['unpaid_or_speculative', /\b(unpaid|exposure only|work for free|commission only)\b/i, -4],
  ['course_or_training', /\b(course|tutorial|training|learn how|certificate)\b/i, -2],
  ['aggregator_or_social', /\b(login|sign up|sign in|search results)\b/i, -1],
];

export function scoreOpportunity({ title = '', description = '', query = '', url = '' } = {}) {
  const text = [title, description, query].join(' ');
  const signals = [];
  let score = 35;
  for (const [name, pattern, weight] of POSITIVE_SIGNALS) {
    if (pattern.test(text)) { score += weight * 8; signals.push({ name, impact: weight * 8 }); }
  }
  for (const [name, pattern, weight] of NEGATIVE_SIGNALS) {
    if (pattern.test(text)) { score += weight * 8; signals.push({ name, impact: weight * 8 }); }
  }
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch {}
  if (host && /(^|\.)(linkedin|facebook|instagram|tiktok|reddit|x)\.com$/.test(host)) {
    signals.push({ name: 'social_or_profile_source_needs_manual_review', impact: 0 });
  }
  score = Math.max(0, Math.min(100, score));
  const priority = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  const recommendation = score >= 70
    ? 'Review promptly; verify the buyer, budget, scope and deadline before preparing a proposal.'
    : score >= 45
      ? 'Check whether this is a real, current opportunity with a reachable buyer and clear paid scope.'
      : 'Low-confidence match; inspect the source before spending time or contacting anyone.';
  return { score, priority, signals, recommendation, confidence: 'heuristic_not_verified' };
}
