import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "inverse" | "outline" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0070e0] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none select-none motion-reduce:transition-none motion-reduce:transform-none active:scale-[0.98]";

    const variantStyles = {
      primary:
        "bg-[#0070e0] text-white hover:bg-[#005fc2] shadow-xs active:bg-[#005fc2]",
      secondary:
        "bg-white dark:bg-[#111113] border border-[#d4d4d8] dark:border-white/15 text-[#111111] dark:text-[#f4f4f2] hover:bg-[#f4f4f5] dark:hover:bg-[#1a1a1d] shadow-xs",
      inverse:
        "bg-[#111111] text-white hover:bg-[#2b2b2b] dark:bg-[#f4f4f2] dark:text-[#0a0a0b] dark:hover:bg-[#dadad6] shadow-xs",
      outline:
        "border border-[#ebebeb] dark:border-white/10 bg-transparent text-[#111111] dark:text-[#f4f4f2] hover:bg-[#f4f4f5] dark:hover:bg-[#1a1a1d]",
      ghost:
        "bg-transparent text-[#333333] dark:text-[#d6d6d3] hover:bg-[#f4f4f5] dark:hover:bg-[#1a1a1d]",
      danger:
        "bg-[#d92d20] text-white hover:bg-[#b42318] shadow-xs",
    };

    const sizeStyles = {
      xs: "h-6 px-2 text-xs leading-4 rounded-[6px]",
      sm: "h-7 px-3 text-[13px] leading-4 rounded-[8px]",
      md: "h-8 px-3 text-[13px] leading-4 rounded-[10px]",
      lg: "h-10 px-4 text-sm leading-5 rounded-[10px]",
      xl: "h-11 px-6 text-[15px] leading-5 rounded-full tracking-[-0.01em]",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        aria-busy={isLoading ? "true" : undefined}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {isLoading ? (
          <span className="inline-flex items-center gap-2">
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            <span>Loading...</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
