// Use distinctive tool/protocol markers, not ordinary words such as "error",
// "timeout", or "cmd", which can legitimately occur in dialogue.
const TOOL_OUTPUT_MARKERS = /\b(?:yield_time_ms|max_output_tokens|multi_tool_use\.parallel|recipient_name|functions\.(?:exec|wait)|tools\.(?:exec_command|write_stdin))\b|<\|(?:tool_call|tool_result|im_start|im_end)\|>/giu;

export function findUnexpectedToolOutput(source: string, translation: string): string | undefined {
  const markers = (text: string) => [...text.normalize('NFKC').matchAll(TOOL_OUTPUT_MARKERS)]
    .map((match) => match[0].toLowerCase());
  const sourceMarkers = new Set(markers(source));
  // Preserve technical terms when the source itself actually discusses them.
  return markers(translation).find((marker) => !sourceMarkers.has(marker));
}
