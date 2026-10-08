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
        "rounded-lg border border-zinc-200/80 bg-white p-6 dark:border-zinc-800/80 dark:bg-zinc-950",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
