import { cn } from "@/lib/utils";
import { X_MARK_PATH } from "@/lib/x-brand";
import "./x-brand.css";

/** X's official mark, kept separate from Reddix's identity. Adjacent text names X. */
export function XMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={cn("x-mark", className)}
      width={size}
      height={size}
      viewBox="0 0 1200 1227"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* Source: https://about.x.com/en/who-we-are/brand-toolkit */}
      <path d={X_MARK_PATH} />
    </svg>
  );
}
