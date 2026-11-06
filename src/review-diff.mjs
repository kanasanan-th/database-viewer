// Trim matching ends and bound the work for large replacements.
export function reviewDiff(before, after) {
  const lines = [];
  let left = 0;
  let right = 0;
  let endLeft = before.length;
  let endRight = after.length;
  const same = () => lines.push({ kind: 'same', text: before[left], old: ++left, next: ++right });
  const remove = () => lines.push({ kind: 'removed', text: before[left], old: ++left });
  const add = () => lines.push({ kind: 'added', text: after[right], next: ++right });
  while (left < endLeft && right < endRight && before[left] === after[right]) same();
  while (left < endLeft && right < endRight && before[endLeft - 1] === after[endRight - 1]) {
    endLeft--;
    endRight--;
  }
  const height = endLeft - left + 1;
  const width = endRight - right + 1;
  if (height > 1 && width > 1 && height * width <= 1_000_000) {
    const startLeft = left;
    const startRight = right;
    const lengths = new Uint32Array(height * width);
    for (let i = height - 2; i >= 0; i--) {
      for (let j = width - 2; j >= 0; j--) {
        const offset = i * width + j;
        lengths[offset] =
          before[startLeft + i] === after[startRight + j]
            ? 1 + lengths[offset + width + 1]
            : Math.max(lengths[offset + width], lengths[offset + 1]);
      }
    }
    while (left < endLeft && right < endRight) {
      const offset = (left - startLeft) * width + right - startRight;
      if (before[left] === after[right]) same();
      else if (lengths[offset + width] >= lengths[offset + 1]) remove();
      else add();
    }
  }
  while (left < endLeft) remove();
  while (right < endRight) add();
  while (left < before.length) same();
  return lines;
}

export const sourceLines = source => source.replace(/\r\n/g, '\n').split('\n');
export const seedLines = rows =>
  rows.map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))));
