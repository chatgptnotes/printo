"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent-orange text-[#0b1326] hover:bg-accent-orange-dark border border-transparent",
  secondary:
    "bg-surface-2 text-text hover:border-accent-orange/50 border border-border",
  ghost: "bg-transparent text-muted hover:text-text border border-transparent",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", fullWidth, className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`rounded-[10px] px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        VARIANTS[variant]
      } ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
});
