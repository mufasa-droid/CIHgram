import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  inputSize?: "sm" | "md";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = "text",
      label,
      error,
      helperText,
      id,
      inputSize = "md",
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    return (
      <div className="w-full space-y-2">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-[13px] font-medium leading-4 text-[#333333] dark:text-[#d6d6d3]"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <input
            id={inputId}
            type={type}
            ref={ref}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            className={cn(
              "flex w-full rounded-[8px] border border-[#8a8a8a] bg-white px-3 text-sm text-[#111111] placeholder:text-[#6b6b6b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0070e0] focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/40 dark:bg-[#111113] dark:text-[#f4f4f2] dark:placeholder:text-[#8f8f8a] transition-colors motion-reduce:transition-none",
              inputSize === "sm" ? "h-8 text-xs py-1.5" : "h-10 py-2",
              error && "border-[#d92d20] focus-visible:ring-[#d92d20] dark:border-[#f97066]",
              className
            )}
            {...props}
          />
        </div>
        {error ? (
          <p
            id={errorId}
            className="flex items-center gap-1.5 text-xs text-[#b42318] dark:text-[#f97066]"
            role="alert"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm-.75-4.25a.75.75 0 0 1 1.5 0 .75.75 0 0 1-1.5 0zM8 4.75a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4.75z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";
