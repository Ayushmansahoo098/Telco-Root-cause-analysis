import { memo } from "react";
import { ChevronRight, Layers3, MapPinned } from "lucide-react";
import { Handle, Position } from "reactflow";

function getKindIcon(kind) {
  if (kind === "region") {
    return MapPinned;
  }

  return Layers3;
}

export const CategoryNode = memo(({ data }) => {
  const Icon = getKindIcon(data.categoryType);
  const expanded = Boolean(data.expanded);
  const categoryLabel = data.categoryType === "region" ? "Region Group" : "Layer Group";
  const classes = [
    "category-node",
    data.categoryType,
    expanded ? "expanded" : "",
    data.isHot ? "hot pulse" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const toggle = (event) => {
    event.stopPropagation();
    data.onToggle?.(data.id);
  };

  return (
    <div className={`${classes} group`} onClick={toggle}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-2xl border border-cream/10 bg-black/10 p-2 transition-transform duration-300 group-hover:scale-110">
            <Icon className="h-5 w-5 text-cream/85" />
          </div>

          <div className="min-w-0">
            <p className="soft-label leading-none">{categoryLabel}</p>
            <p className="break-anywhere mt-1.5 font-display text-[1.4rem] font-bold leading-tight tracking-tight text-cream">
              {data.label}
            </p>
            <p className="break-anywhere mt-1 text-[0.82rem] font-medium leading-relaxed text-cream/60">
              {data.summary}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggle}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cream/10 bg-black/20 text-cream/80 transition duration-200 hover:border-sand/25 hover:text-cream"
          aria-label={expanded ? "Collapse category" : "Expand category"}
          aria-expanded={expanded}
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
});
