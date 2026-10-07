"use client";
import { useEffect, useEffectEvent, useRef } from "react";

export function Dialog({
  children,
  labelId,
  onClose,
  className = "",
}: {
  children: React.ReactNode;
  labelId: string;
  onClose?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeFromEffect = useEffectEvent(() => onClose?.());
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const element = ref.current!;
    const focusable = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]',
        ),
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFromEffect();
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    element.addEventListener("keydown", onKey);
    return () => {
      element.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className={`modal ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}
