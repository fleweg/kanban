import { cn } from "../../lib/utils";
import type { Tag } from "../../types";

interface TagChipProps {
  tag: Tag;
  size?: "xs" | "sm";
  removable?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
}

// Renders a tag as a small colored badge with auto-computed text
// contrast. The label color is black or white depending on the
// luminance of the background — readable on any user-chosen color
// without falling back to a fixed text/border style. Optional
// trailing ✕ for use inside the TagPicker.
export function TagChip({ tag, size = "xs", removable, onRemove, onClick, className }: TagChipProps) {
  const text = textColorFor(tag.color);
  const Wrapper = onClick ? "button" : "span";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md font-medium leading-none select-none",
        size === "xs" ? "px-1.5 py-0.5 text-[10px] gap-1" : "px-2 py-0.5 text-[11px] gap-1.5",
        onClick && "cursor-pointer hover:opacity-90 transition-opacity",
        className,
      )}
      style={{ backgroundColor: tag.color, color: text }}
      title={tag.name}
    >
      <span className="truncate max-w-[120px]">{tag.name}</span>
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="-mr-0.5 hover:opacity-70 transition-opacity"
          aria-label={`Remove ${tag.name}`}
        >
          ✕
        </button>
      )}
    </Wrapper>
  );
}

// Returns "#000" or "#fff" based on the relative luminance of the
// background color so the text always meets a basic contrast
// threshold. Uses the WCAG luminance formula with sRGB gamma.
function textColorFor(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  if ([r, g, b].some((v) => Number.isNaN(v))) return "#000";
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.5 ? "#000" : "#fff";
}
