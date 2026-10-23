/**
 * Contrast for opaque hexadecimal CSS colors used by the deployed token audit.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function contrast(a, b) {
  const luminance = (hex) => {
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) throw new TypeError('Contrast audit requires an opaque #RGB or #RRGGBB color.');
    const raw = hex.slice(1);
    const expanded = raw.length === 3 ? [...raw].map((channel) => channel + channel).join('') : raw;
    return [0, 1, 2].map((index) => parseInt(expanded.slice(index * 2, index * 2 + 2), 16) / 255)
      .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const x = luminance(a), y = luminance(b);
  return Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(3));
}
