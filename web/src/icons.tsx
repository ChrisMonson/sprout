const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const Leaf = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={1.8} {...base}>
    <path d="M12 21v-9" /><path d="M12 12c0-4 3-7 8-7 0 4-3 7-8 7z" /><path d="M12 14c0-3-2.5-5.5-7-5.5 0 3 2.5 5.5 7 5.5z" />
  </svg>
);

export const Bud = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}>
    <path d="M12 21v-7" /><path d="M12 14c0-3 2-5 6-5 0 3-2 5-6 5z" /><path d="M12 15c0-2.5-1.8-4-5-4 0 2.5 1.8 4 5 4z" />
  </svg>
);

export const Send = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth={2} {...base}><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
);

export const Target = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth={2} {...base}>
    <circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

export const Close = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2.4} {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);

export const History = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} {...base}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></svg>
);

export const Check = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth={2.2} stroke="#2F6B45" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
);

export const Grow = () => (
  <svg width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="#2F6B45" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 84h56" stroke="#C9D3CB" />
    <path className="stem" d="M48 84V36" />
    <path className="lf lf1" d="M48 52c0-14 10-22 26-22 0 14-10 22-26 22z" fill="#E6EFE8" />
    <path className="lf lf2" d="M48 60c0-11-8-18-21-18 0 11 8 18 21 18z" fill="#E6EFE8" />
  </svg>
);

export const Expand = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} {...base}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
);

export const Shrink = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth={2} {...base}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
);
