interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface FencedBlock extends SourceSpan {
  readonly language: string;
}

/** Share Markdown fence boundaries across parsing and name rewriting. */
export function fencedBlocks(text: string): readonly FencedBlock[] {
  const spans: FencedBlock[] = [];
  let fence:
    { readonly marker: string; readonly start: number; readonly language: string } | undefined;
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*?)(?:\r?\n)?$/.exec(line);
    const run = marker?.[1];
    if (fence !== undefined) {
      if (
        run !== undefined &&
        run[0] === fence.marker[0] &&
        run.length >= fence.marker.length &&
        (marker?.[2] ?? "").trim() === ""
      ) {
        spans.push({ start: fence.start, end: offset + line.length, language: fence.language });
        fence = undefined;
      }
    } else if (run !== undefined && !(run[0] === "`" && marker?.[2]?.includes("`"))) {
      fence = { marker: run, start: offset, language: (marker?.[2] ?? "").trim().toLowerCase() };
    }
    offset += line.length;
  }
  if (fence !== undefined)
    spans.push({ start: fence.start, end: text.length, language: fence.language });
  return spans;
}

/** Quoted strings and comments in a code example cannot contain executable tool calls. */
export function codeLiteral(text: string, fence: FencedBlock, offset: number): boolean {
  for (let i = text.indexOf("\n", fence.start) + 1; i < offset; i++) {
    if (text.startsWith("//", i) || text[i] === "#") {
      const end = text.indexOf("\n", i);
      if (end < 0 || end >= offset) return true;
      i = end;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end < 0 || end + 2 > offset) return true;
      i = end + 1;
    } else {
      const quote = text[i];
      if (quote !== '"' && quote !== "'" && quote !== "`") continue;
      const delimiter = text.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote;
      i += delimiter.length;
      for (; i < offset; i++) {
        if (text[i] === "\\") i++;
        else if (text.startsWith(delimiter, i)) break;
      }
      if (i >= offset) return true;
      i += delimiter.length - 1;
    }
  }
  return false;
}

/** Interaction syntax inside Markdown examples is documentation, not a live call. */
export function interactionExamples(text: string): readonly SourceSpan[] {
  const spans: SourceSpan[] = [...fencedBlocks(text)];
  const ticks = /`+/g;
  for (let match = ticks.exec(text); match !== null; match = ticks.exec(text)) {
    const block = spans.find((span) => span.start <= match.index && match.index < span.end);
    if (block !== undefined) {
      ticks.lastIndex = block.end;
      continue;
    }
    const opening = match;
    for (let closing = ticks.exec(text); closing !== null; closing = ticks.exec(text)) {
      if (spans.some((span) => span.start <= closing.index && closing.index < span.end)) break;
      if (closing[0].length === opening[0].length) {
        spans.push({ start: opening.index, end: ticks.lastIndex });
        break;
      }
    }
    // An unmatched run is ordinary text; later runs can still open their own span.
    ticks.lastIndex =
      spans.find((span) => span.start === opening.index)?.end ?? opening.index + opening[0].length;
  }
  return spans.filter((span) => /<\/?interaction>/.test(text.slice(span.start, span.end)));
}
