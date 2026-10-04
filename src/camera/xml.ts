import { XMLParser } from 'fast-xml-parser';

import { errorMessage } from './http.ts';

/**
 * One node of fast-xml-parser's `preserveOrder` output: `{ [tag]: children[], ':@'?: attrs }`,
 * or `{ '#text': string }` for a text node.
 */
export type XmlNode = Record<string, unknown>;

// `removeNSPrefix` gives namespace-agnostic matching on local names (`dc:title` -> `title`).
// `preserveOrder` keeps document order across different sibling tags (containers vs items).
// Entities are decoded in a single left-to-right scan, so `&amp;lt;` becomes `&lt;` (not `<`)
// and text containing entities is never split or truncated.
const parser = new XMLParser({
  preserveOrder: true,
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  // Also resolves numeric character references (`&#60;`).
  htmlEntities: true,
});

export function parseXml(xml: string): XmlNode[] {
  try {
    return parser.parse(xml) as XmlNode[];
  } catch (err) {
    throw new Error(`failed to parse XML: ${errorMessage(err)}`);
  }
}

export function tagName(node: XmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ':@' && key !== '#text');
}

export function childNodes(node: XmlNode): XmlNode[] {
  const tag = tagName(node);
  const children = tag ? node[tag] : undefined;
  return Array.isArray(children) ? (children as XmlNode[]) : [];
}

export function attr(node: XmlNode, name: string): string | undefined {
  return (node[':@'] as Record<string, string> | undefined)?.[name];
}

/** Concatenated text of the element's direct text children. */
export function textOf(node: XmlNode): string {
  return childNodes(node)
    .map((child) => (child['#text'] === undefined ? '' : String(child['#text'])))
    .join('');
}

/** Every element under `nodes`, depth-first in document order. */
export function* descendants(nodes: XmlNode[]): Generator<XmlNode> {
  for (const node of nodes) {
    if (!tagName(node)) continue;
    yield node;
    yield* descendants(childNodes(node));
  }
}

/**
 * A second pass of standard-XML-entity unescaping.
 *
 * The camera's SOAP `<Result>` element is escaped twice: once for the outer SOAP envelope
 * (undone by the parser's normal text decoding), and a second time because the embedded
 * DIDL-Lite document was itself escaped before being embedded as text (e.g. a literal `<`
 * inside a title survives as `&amp;lt;`, not just `&lt;`, in the raw HTTP body). This undoes
 * that second pass so the result can be parsed as XML.
 *
 * `&amp;` must be replaced last: replacing it first would turn `&amp;lt;` into `&lt;` before
 * the `&lt;` -> `<` replacement runs, resolving two levels in one pass.
 */
export function unescapeXmlEntitiesOnce(s: string): string {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
