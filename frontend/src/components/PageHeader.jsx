export default function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-7">
      <div>
        {eyebrow && (
          <div className="chip mb-3">{eyebrow}</div>
        )}
        <h1 className="font-serif text-3xl md:text-[34px] font-bold text-charcoal-900 leading-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-charcoal-500 mt-2 max-w-3xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
