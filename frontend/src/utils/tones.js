// One place for tone -> Tailwind class strings. Every class is written out in
// full so the JIT scanner can see it (interpolated names are never emitted).
export const TONES = {
  coral:   { badge: "bg-coral-100 text-coral-700",     soft: "bg-coral-50 text-coral-600",       dot: "bg-coral-500",   bar: "bg-coral-500",   ring: "ring-coral-200" },
  slate:   { badge: "bg-slate-100 text-slate-700",     soft: "bg-charcoal-50 text-charcoal-500", dot: "bg-slate-400",   bar: "bg-slate-400",   ring: "ring-charcoal-200" },
  emerald: { badge: "bg-emerald-100 text-emerald-700", soft: "bg-emerald-50 text-emerald-600",   dot: "bg-emerald-500", bar: "bg-emerald-500", ring: "ring-emerald-200" },
  amber:   { badge: "bg-amber-100 text-amber-800",     soft: "bg-amber-50 text-amber-600",       dot: "bg-amber-500",   bar: "bg-amber-400",   ring: "ring-amber-200" },
  blue:    { badge: "bg-blue-100 text-blue-700",       soft: "bg-blue-50 text-blue-600",         dot: "bg-blue-500",    bar: "bg-blue-500",    ring: "ring-blue-200" },
  indigo:  { badge: "bg-indigo-100 text-indigo-700",   soft: "bg-indigo-50 text-indigo-600",     dot: "bg-indigo-500",  bar: "bg-indigo-500",  ring: "ring-indigo-200" },
  teal:    { badge: "bg-teal-100 text-teal-700",       soft: "bg-teal-50 text-teal-600",         dot: "bg-teal-500",    bar: "bg-teal-500",    ring: "ring-teal-200" },
  green:   { badge: "bg-green-100 text-green-700",     soft: "bg-green-50 text-green-600",       dot: "bg-green-500",   bar: "bg-green-500",   ring: "ring-green-200" },
  red:     { badge: "bg-red-100 text-red-700",         soft: "bg-red-50 text-red-600",           dot: "bg-red-500",     bar: "bg-red-500",     ring: "ring-red-200" },
};

// Unknown tone -> neutral, never undefined (callers spread these into className).
export const toneOf = (tone) => TONES[tone] || TONES.slate;
