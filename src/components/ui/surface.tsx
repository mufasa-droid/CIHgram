import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
}

export function Surface({
  as: Component = "div",
  className,
  children,
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={cn(
        "rounded-2xl border border-[#ebebeb] bg-white p-6 dark:border-white/[0.08] dark:bg-[#111113] shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
