type ClassValue = string | number | boolean | undefined | null;

/**
 * Lightweight class name merger without unnecessary heavy dependencies.
 */
export function cn(...inputs: ClassValue[]): string {
  return inputs
    .filter((x): x is string | number => Boolean(x) && typeof x !== "boolean")
    .join(" ");
}
