import type { JSX } from 'react';

/** A single stroke-based icon set, so everything shares one weight and cap. */
const base = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const ArrowLeft = (): JSX.Element => (
  <svg {...base}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
);

export const ArrowRight = (): JSX.Element => (
  <svg {...base}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
);

export const Reload = (): JSX.Element => (
  <svg {...base}><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
);

export const Gear = (): JSX.Element => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const Panel = (): JSX.Element => (
  <svg {...base}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
);

/* --- step icons ----------------------------------------------------------- */

const step = { ...base, width: 11, height: 11, strokeWidth: 2.6 };

export const Cursor = (): JSX.Element => (
  <svg {...step}><path d="M4 3l7 17 2.5-7L20 10.5z" /></svg>
);

export const Keyboard = (): JSX.Element => (
  <svg {...step}><path d="M4 7h16M4 12h16M8 17h8" /></svg>
);

export const Globe = (): JSX.Element => (
  <svg {...step}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" /></svg>
);

export const ChevronsDown = (): JSX.Element => (
  <svg {...step}><path d="M7 6l5 5 5-5M7 13l5 5 5-5" /></svg>
);

export const Check = (): JSX.Element => (
  <svg {...step}><path d="M20 6L9 17l-5-5" /></svg>
);

export const Cross = (): JSX.Element => (
  <svg {...step}><path d="M18 6L6 18M6 6l12 12" /></svg>
);

export const Hand = (): JSX.Element => (
  <svg {...step}>
    <path d="M18 11V6a1.5 1.5 0 0 0-3 0M15 11V4.5a1.5 1.5 0 0 0-3 0V11M12 11V6a1.5 1.5 0 0 0-3 0v8" />
    <path d="M9 12.5L7.2 10a1.5 1.5 0 0 0-2.4 1.8L8 17a6 6 0 0 0 10-4.5V11" />
  </svg>
);

export const Bookmark = (): JSX.Element => (
  <svg {...step}><path d="M6 3h12v18l-6-4.5L6 21z" /></svg>
);

export const Clock = (): JSX.Element => (
  <svg {...step}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

export const Shield = (): JSX.Element => (
  <svg {...step}><path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z" /></svg>
);

export const Eye = (): JSX.Element => (
  <svg {...step}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
