/**
 * Official College of Caspian University crest.
 * Uses the bundled PNG at /ccu-logo.png so the real artwork
 * is rendered everywhere it appears.
 */
export default function BrandLogo({
  size = 56,
  withWordmark = false,
  className = "",
  variant = "default", // "default" | "light"
}) {
  const isLight = variant === "light";
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <img
        src="/ccu-logo.png"
        alt="College of Caspian University"
        width={size}
        height={size}
        className="shrink-0 object-contain drop-shadow-sm select-none"
        style={{ width: size, height: size }}
        draggable={false}
      />
      {withWordmark && (
        <span className="leading-tight">
          <span
            className={`block font-serif font-extrabold tracking-tight ${
              isLight ? "text-white" : "text-charcoal-900"
            }`}
            style={{ fontSize: Math.max(14, size * 0.32) }}
          >
            CCU PRACTICUM
          </span>
          <span
            className={`block text-[10px] uppercase tracking-[0.22em] ${
              isLight ? "text-white/75" : "text-charcoal-400"
            }`}
          >
            College of Caspian University
          </span>
        </span>
      )}
    </span>
  );
}
