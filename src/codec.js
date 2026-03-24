export function encodeMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

export function decodeMessage(line) {
  if (typeof line !== "string" || line.length === 0) {
    throw new TypeError("line must be a non-empty string");
  }
  return JSON.parse(line);
}
