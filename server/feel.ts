// "How should it feel?" presets. Each becomes a sprout's src/feel.css tokens.

export interface Feel {
  id: string;
  name: string;
  blurb: string;
  fonts: string; // Google Fonts css2 family query
  tokens: Record<string, string>;
}

export const FEELS: Feel[] = [
  {
    id: 'calm',
    name: 'Calm',
    blurb: 'Soft, quiet, unhurried',
    fonts: 'family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700',
    tokens: {
      bg: '#F1F5F3', surface: '#FFFFFF', ink: '#1E2A28', muted: '#55645F', line: '#DCE5E1',
      accent: '#3B7A70', 'accent-ink': '#FFFFFF', 'accent-soft': '#E1EEEA',
      'font-head': "'DM Sans', system-ui, sans-serif", 'font-body': "'DM Sans', system-ui, sans-serif",
      'head-weight': '600', radius: '14px', border: '1px solid #DCE5E1', shadow: '0 1px 2px rgba(30, 42, 40, 0.06)',
    },
  },
  {
    id: 'professional',
    name: 'Professional',
    blurb: 'Crisp, dense, no-nonsense',
    fonts: 'family=Inter:wght@400;500;600;700',
    tokens: {
      bg: '#F4F5F7', surface: '#FFFFFF', ink: '#111827', muted: '#4B5563', line: '#E2E5EA',
      accent: '#1D4ED8', 'accent-ink': '#FFFFFF', 'accent-soft': '#E3EAFD',
      'font-head': "'Inter', system-ui, sans-serif", 'font-body': "'Inter', system-ui, sans-serif",
      'head-weight': '600', radius: '6px', border: '1px solid #E2E5EA', shadow: '0 1px 2px rgba(17, 24, 39, 0.06)',
    },
  },
  {
    id: 'organic',
    name: 'Organic',
    blurb: 'Warm, earthy, handmade',
    fonts: 'family=Fraunces:opsz,wght@9..144,500;9..144,600&family=DM+Sans:opsz,wght@9..40,400;9..40,600',
    tokens: {
      bg: '#F2EDE3', surface: '#FBF8F1', ink: '#2B2A22', muted: '#5C5848', line: '#E4DCCB',
      accent: '#5A6D2F', 'accent-ink': '#FFFFFF', 'accent-soft': '#E8EAD6',
      'font-head': "'Fraunces', Georgia, serif", 'font-body': "'DM Sans', system-ui, sans-serif",
      'head-weight': '600', radius: '18px', border: '1px solid #E4DCCB', shadow: 'none',
    },
  },
  {
    id: 'quirky',
    name: 'Quirky',
    blurb: 'Loud, chunky, a little silly',
    fonts: 'family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700',
    tokens: {
      bg: '#FFF1C9', surface: '#FFFFFF', ink: '#1F1B2E', muted: '#4A4360', line: '#1F1B2E',
      accent: '#B83A14', 'accent-ink': '#FFFFFF', 'accent-soft': '#FFE0D3',
      'font-head': "'Bricolage Grotesque', system-ui, sans-serif", 'font-body': "'Bricolage Grotesque', system-ui, sans-serif",
      'head-weight': '700', radius: '20px', border: '2px solid #1F1B2E', shadow: '4px 4px 0 #1F1B2E',
    },
  },
];

export function feelById(id: string | undefined): Feel {
  return FEELS.find(f => f.id === id) ?? FEELS[0];
}

export function feelCss(feel: Feel): string {
  const lines = Object.entries({ ...feel.tokens, space: '8px' }).map(([k, v]) => `  --${k}: ${v};`);
  return [
    `@import url('https://fonts.googleapis.com/css2?${feel.fonts}&display=swap');`,
    '',
    `/* Design tokens for this sprout (feel: ${feel.name}). Every style uses these variables. */`,
    ':root {',
    ...lines,
    '}',
    '',
  ].join('\n');
}
