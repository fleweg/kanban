// HTML conversion helpers between Asana's `html_notes` / `html_text`
// dialect and the TipTap-compatible HTML used by the rest of the
// Kanban (ticket description, comment body).
//
// Asana's whitelist is documented at:
//   https://developers.asana.com/docs/rich-text
// In practice it accepts: strong, em, u, s, code, pre, ol, ul, li,
// blockquote, h1, h2, hr, a, img, plus <body> as the outer wrapper.
// Everything else is stripped server-side or returns 400.
//
// Strategy:
//   - asanaToTipTap: parse with DOMParser, unwrap <body>, normalize a
//     few tag mismatches (<b> → <strong>), drop disallowed nodes.
//   - tiptapToAsana: parse the TipTap output, walk the tree, emit only
//     allowed tags. <p> becomes a sequence of inline children + <br>
//     between paragraphs (Asana doesn't allow <p>).
//
// The hidden marker `<!-- kanban-origin -->` is preserved through both
// directions: comments we post to Asana carry it so the next poll
// loop can skip its own echoes.

export const ORIGIN_MARKER = "<!-- kanban-origin -->";

// Crude but adequate hidden marker: a zero-width span with a data
// attribute. Used as a fallback for HTML pipelines that strip comment
// nodes — Asana keeps comments through `html_text`, but we belt-and-
// suspenders with a tag-based marker too. Order matters: insert the
// span FIRST so it doesn't get nested inside the marker comment if
// Asana ever wraps the body.
export const ORIGIN_MARKER_SPAN =
  '<span data-kanban-origin="1" style="display:none"></span>';

export function hasOriginMarker(html: string | null | undefined): boolean {
  if (!html) return false;
  return html.includes(ORIGIN_MARKER) || html.includes('data-kanban-origin="1"');
}

// Tags Asana accepts inside <body>. Anything else is dropped or
// downgraded by the converter.
const ASANA_ALLOWED = new Set([
  "strong",
  "em",
  "u",
  "s",
  "code",
  "pre",
  "ol",
  "ul",
  "li",
  "blockquote",
  "h1",
  "h2",
  "hr",
  "a",
  "img",
  "br",
]);

// Normalise an Asana html_notes / html_text value into TipTap-friendly
// HTML. Returns "" when the input is empty.
export function asanaToTipTap(html: string | null | undefined): string {
  if (!html) return "";
  // Strip the optional <body>…</body> wrapper. We use a regex first
  // because DOMParser will silently mishandle it as an HTML document
  // root (DOMParser already inserts its own body wrapping the parsed
  // fragment). Keep the inner content.
  const inner = html
    .replace(/^\s*<body>/i, "")
    .replace(/<\/body>\s*$/i, "")
    .trim();
  if (!inner) return "";

  // Asana uses <b>/<i> in old data; normalise to TipTap's strong/em
  // before parsing so the downstream pipeline doesn't have to know
  // about both spellings.
  const normalised = inner
    .replace(/<b(\s[^>]*)?>/gi, "<strong$1>")
    .replace(/<\/b>/gi, "</strong>")
    .replace(/<i(\s[^>]*)?>/gi, "<em$1>")
    .replace(/<\/i>/gi, "</em>");

  // Wrap loose inline content in a paragraph so TipTap doesn't choke.
  // Heuristic: if there's no block tag in the input, wrap the whole
  // thing in <p>…</p>.
  const hasBlock = /<(p|h1|h2|h3|h4|ol|ul|blockquote|pre|hr|div)\b/i.test(normalised);
  return hasBlock ? normalised : `<p>${normalised}</p>`;
}

// Convert TipTap HTML output (paragraphs, headings, lists, marks,
// links) into the restricted Asana dialect — strips disallowed tags
// and downgrades <p> into <br>-separated inline content (Asana has no
// paragraph element).
//
// The returned string is the BODY content only — callers wrap it in
// <body>…</body> when POSTing to Asana (see client.ts.postStory).
export function tiptapToAsana(html: string | null | undefined): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") {
    // Non-browser fallback (SSR / tests): strip everything but text.
    return html.replace(/<[^>]+>/g, "").trim();
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  let out = "";
  let firstParaSeen = false;
  for (const child of Array.from(root.childNodes)) {
    const piece = serializeNode(child, false);
    if (!piece) continue;
    // Paragraph-level elements get separated by a <br><br>; the FIRST
    // one is emitted bare.
    if (isParagraphLike(child)) {
      if (firstParaSeen) out += "<br><br>";
      out += piece;
      firstParaSeen = true;
    } else {
      out += piece;
      firstParaSeen = true;
    }
  }
  return out.trim();
}

function isParagraphLike(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const tag = (node as Element).tagName.toLowerCase();
  return tag === "p" || tag === "div";
}

function serializeNode(node: Node, insideAllowed: boolean): string {
  if (node.nodeType === 3) {
    return escapeText(node.textContent ?? "");
  }
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tagRaw = el.tagName.toLowerCase();
  // Heading downgrades — Asana caps at h1/h2.
  let tag = tagRaw;
  if (tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") tag = "h2";
  if (tag === "b") tag = "strong";
  if (tag === "i") tag = "em";
  if (tag === "del") tag = "s";
  if (tag === "p" || tag === "div") {
    // Inline children only — see tiptapToAsana for the <br> joining.
    return serializeChildren(el, insideAllowed);
  }
  if (!ASANA_ALLOWED.has(tag)) {
    // Unknown tag → emit its children but drop the wrapper.
    return serializeChildren(el, insideAllowed);
  }
  // Build the open tag with the minimal allowed attributes.
  let open = `<${tag}`;
  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    if (href) open += ` href="${escapeAttr(href)}"`;
  }
  if (tag === "img") {
    const src = el.getAttribute("src") ?? "";
    const alt = el.getAttribute("alt") ?? "";
    if (src) open += ` src="${escapeAttr(src)}"`;
    if (alt) open += ` alt="${escapeAttr(alt)}"`;
    return open + " />";
  }
  open += ">";
  const inner = serializeChildren(el, true);
  return `${open}${inner}</${tag}>`;
}

function serializeChildren(el: Element, insideAllowed: boolean): string {
  let out = "";
  for (const c of Array.from(el.childNodes)) {
    out += serializeNode(c, insideAllowed);
  }
  return out;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
