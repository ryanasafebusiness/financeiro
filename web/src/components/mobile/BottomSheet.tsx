import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dragStart = useRef(0);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const sheet = sheetRef.current;
    requestAnimationFrame(() => sheet?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
      if (event.key !== "Tab" || !sheet) return;
      const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onOpenChange, open]);

  if (!open) return null;

  const finishDrag = () => {
    if (dragY > 96) onOpenChange(false);
    setDragY(0);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:hidden">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-[1px] animate-fade-in"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 max-h-[min(88dvh,46rem)] w-full overflow-y-auto overscroll-contain rounded-t-[1.5rem] bg-card shadow-lg",
          "pb-[calc(1.25rem+env(safe-area-inset-bottom))] animate-slide-up",
          dragY === 0 && "transition-transform duration-200 ease-out-soft",
          className
        )}
        style={{ transform: `translateY(${dragY}px)` }}
      >
        <div
          className="sticky top-0 z-10 flex touch-none justify-center bg-card pb-2 pt-2.5"
          onPointerDown={(event) => {
            dragStart.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            setDragY(Math.max(0, event.clientY - dragStart.current));
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <span className="h-1 w-10 rounded-pill bg-muted-foreground/30" />
        </div>
        <div className="flex items-start gap-3 px-5 pb-4 pt-1">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 text-body text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>
  );
}
