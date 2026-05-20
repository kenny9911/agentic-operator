/**
 * Logo — 24×24 lime square with grid dots. v1_1 app.jsx:166-179.
 * Kept verbatim; used inside the Sidebar header.
 */
export function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-label="Agentic Operator">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--signal)" />
      <g transform="translate(5,5)">
        <circle cx="3" cy="3" r="1.5" fill="#000" />
        <circle cx="11" cy="3" r="1.5" fill="#000" />
        <circle cx="3" cy="11" r="1.5" fill="#000" />
        <circle cx="11" cy="11" r="1.5" fill="#000" />
        <path
          d="M3 3 L11 3 M3 3 L3 11 M11 3 L11 11 M3 11 L11 11 M3 3 L11 11"
          stroke="#000"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
