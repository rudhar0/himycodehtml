export const getCssVar = (name: string, fallback: string): string => {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value.length > 0 ? value : fallback;
};

export const isDarkTheme = (): boolean => {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("dark");
};

export const clampText = (text: string, maxLen: number): string => {
  const safe = String(text ?? "");
  if (safe.length <= maxLen) return safe;
  return safe.slice(0, Math.max(0, maxLen - 1)) + "…";
};

