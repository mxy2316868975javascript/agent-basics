export function approximateTokens(text: string): number {
  const asciiLength = (text.match(/[\x00-\x7F]/gu) ?? []).length;
  const nonAsciiLength = text.length - asciiLength;
  return Math.max(1, Math.ceil(asciiLength / 4 + nonAsciiLength / 1.5));
}
