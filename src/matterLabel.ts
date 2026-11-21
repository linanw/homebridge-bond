// Matter's bridged node label has a 32-byte UTF-8 limit.
export function matterLabel(name: string): string {
  let text = '';
  for (const point of name) {
    if (Buffer.byteLength(text + point) > 32) {
      break;
    }
    text += point;
  }
  return text;
}
