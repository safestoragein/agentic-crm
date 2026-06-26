"use client";

// Friendly "Buddy" robot mascot, drawn as inline SVG so it stays crisp,
// recolourable and dependency-free. The raised arm waves and the eyes blink.
export default function RobotBuddy({ className = "" }) {
  return (
    <svg
      viewBox="0 0 420 460"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Buddy, the SafeStorage CRM assistant robot"
    >
      <defs>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbe7ff" />
        </linearGradient>
        <linearGradient id="blueGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#93b8ff" />
          <stop offset="1" stopColor="#5b8def" />
        </linearGradient>
        <linearGradient id="screenGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.9" />
          <stop offset="1" stopColor="#7dd3fc" stopOpacity="0" />
        </radialGradient>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#5b8def" floodOpacity="0.18" />
        </filter>
      </defs>

      {/* orbital rings behind the robot */}
      <g opacity="0.5" stroke="#a5c2ff" strokeWidth="3" fill="none">
        <ellipse cx="150" cy="150" rx="118" ry="118" />
        <ellipse cx="120" cy="190" rx="86" ry="86" opacity="0.7" />
      </g>

      {/* ground shadow */}
      <ellipse cx="210" cy="430" rx="120" ry="18" fill="#5b8def" opacity="0.12" />

      <g filter="url(#soft)">
        {/* antenna */}
        <line x1="210" y1="78" x2="210" y2="40" stroke="#9bb9ef" strokeWidth="7" strokeLinecap="round" />
        <circle cx="210" cy="34" r="11" fill="url(#blueGrad)" />
        <circle cx="210" cy="34" r="20" fill="url(#glow)" className="animate-pulse-soft" />

        {/* head */}
        <rect x="96" y="78" width="228" height="186" rx="46" fill="url(#bodyGrad)" stroke="#c7d8fb" strokeWidth="2" />
        {/* ears */}
        <rect x="80" y="150" width="22" height="48" rx="11" fill="url(#blueGrad)" />
        <rect x="318" y="150" width="22" height="48" rx="11" fill="url(#blueGrad)" />

        {/* screen face */}
        <rect x="124" y="104" width="172" height="134" rx="34" fill="url(#screenGrad)" />
        {/* corner brackets */}
        <g stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" opacity="0.85">
          <path d="M142 126 v-6 a6 6 0 0 1 6 -6 h6" />
          <path d="M278 114 h6 a6 6 0 0 1 6 6 v6" />
          <path d="M142 216 v6 a6 6 0 0 0 6 6 h6" />
          <path d="M290 216 v6 a6 6 0 0 1 -6 6 h-6" />
        </g>
        {/* happy eyes */}
        <g
          stroke="#5eead4"
          strokeWidth="11"
          strokeLinecap="round"
          fill="none"
          className="animate-blink"
          style={{ transformOrigin: "210px 175px", filter: "drop-shadow(0 0 6px #5eead4)" }}
        >
          <path d="M158 188 q22 -34 44 0" />
          <path d="M218 188 q22 -34 44 0" />
        </g>

        {/* body */}
        <rect x="146" y="270" width="128" height="104" rx="40" fill="url(#bodyGrad)" stroke="#c7d8fb" strokeWidth="2" />
        {/* chest light */}
        <circle cx="210" cy="318" r="20" fill="url(#blueGrad)" />
        <circle cx="210" cy="318" r="9" fill="#bff0ff" className="animate-pulse-soft" />

        {/* left (lowered) arm */}
        <rect x="118" y="292" width="34" height="74" rx="17" fill="url(#blueGrad)" transform="rotate(18 135 292)" />

        {/* right (waving) arm */}
        <g className="animate-wave" style={{ transformOrigin: "286px 300px" }}>
          <rect x="270" y="214" width="34" height="92" rx="17" fill="url(#blueGrad)" transform="rotate(28 287 300)" />
          <circle cx="318" cy="226" r="20" fill="url(#blueGrad)" />
        </g>
      </g>
    </svg>
  );
}
