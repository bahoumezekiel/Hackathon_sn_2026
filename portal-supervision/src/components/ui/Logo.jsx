// FasoLink — logo : étoile du drapeau dans un carré vert, suivie du nom.
// `tag` affiche le nom du portail (« Guichet », « Supervision »…).
export function LogoMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#0b6e4f" />
      <rect y="16" width="32" height="16" rx="0" fill="#0b5a41" opacity="0.55" />
      <path fill="#fcd116"
        d="M16 6.5l2.6 6.1 6.6.5-5 4.3 1.6 6.4L16 20.4l-5.8 3.4 1.6-6.4-5-4.3 6.6-.5z" />
    </svg>
  );
}

export function Logo({ tag, size = 28 }) {
  return (
    <span className="fl-logo">
      <LogoMark size={size} />
      <span className="fl-logo__name">FasoLink</span>
      {tag && <span className="fl-logo__tag">{tag}</span>}
    </span>
  );
}
