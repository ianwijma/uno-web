"use client";
import { useRef } from "react";
import * as Primitive from "@radix-ui/react-dialog";
export const DialogTitle = Primitive.Title;

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
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Primitive.Root
      key={labelId}
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="modal-backdrop">
          <Primitive.Content
            className={`modal ${className}`}
            aria-labelledby={labelId}
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              returnFocus.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocus.current?.focus();
            }}
            onEscapeKeyDown={(event) => {
              if (!onClose) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (!onClose) event.preventDefault();
            }}
          >
            {children}
          </Primitive.Content>
        </Primitive.Overlay>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
