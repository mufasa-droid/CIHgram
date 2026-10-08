import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "full";
}

export function Container({
  size = "md",
  className,
  children,
  ...props
}: ContainerProps) {
  const sizeStyles = {
    sm: "max-w-xl",
    md: "max-w-3xl",
    lg: "max-w-5xl",
    full: "max-w-7xl",
  };

  return (
    <div
      className={cn("mx-auto w-full px-6 sm:px-8", sizeStyles[size], className)}
      {...props}
    >
      {children}
    </div>
  );
}
