export type HelpBox = { x: number; y: number; width: number; height: number };

// Merge touching outlines as well as their padded cutouts, including chains.
export function mergeHelpBoxes(input: HelpBox[]): HelpBox[] {
  const boxes: HelpBox[] = [];
  for (const item of input) {
    let box = { ...item };
    for (let index = 0; index < boxes.length;) {
      const other = boxes[index];
      if (
        box.x <= other.x + other.width + 4 &&
        other.x <= box.x + box.width + 4 &&
        box.y <= other.y + other.height + 4 &&
        other.y <= box.y + box.height + 4
      ) {
        const x = Math.min(box.x, other.x),
          y = Math.min(box.y, other.y);
        box = {
          x,
          y,
          width: Math.max(box.x + box.width, other.x + other.width) - x,
          height: Math.max(box.y + box.height, other.y + other.height) - y,
        };
        boxes.splice(index, 1);
        index = 0;
      } else index++;
    }
    boxes.push(box);
  }
  return boxes;
}
