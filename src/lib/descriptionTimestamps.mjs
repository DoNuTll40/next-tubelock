// Split inline text while retaining marks, including timestamps split across bold/italic runs.
export function splitDescriptionTimestamps(nodes) {
  const text = nodes.map(node => node.text || '').join('');
  const runs = [];
  let offset = 0;
  for (const node of nodes) {
    const start = offset;
    offset += (node.text || '').length;
    runs.push({ start, end: offset, node });
  }
  const pieces = (start, end) => runs.filter(run => run.start < end && run.end > start).map(run => ({ text: run.node.text.slice(Math.max(0, start - run.start), Math.min(run.node.text.length, end - run.start)), marks: run.node.marks || [] }));
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(/(?:(?:\d{1,2}):)?[0-5]?\d:[0-5]\d/g)) {
    if (match.index > cursor) segments.push({ parts: pieces(cursor, match.index) });
    const parts = pieces(match.index, match.index + match[0].length);
    const linkedOrCode = parts.some(part => part.marks.some(mark => mark.type === 'link' || mark.type === 'code'));
    const seconds = match[0].split(':').reduce((total, number) => total * 60 + Number(number), 0);
    segments.push({ parts, ...(linkedOrCode ? {} : { seconds }) });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ parts: pieces(cursor, text.length) });
  return segments;
}
