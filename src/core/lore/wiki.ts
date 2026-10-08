import type { WikiPageResult, WikiSearchResult } from './types';

/**
 * Lookups on https://warcraft.wiki.gg, for lore. Two requests only, a search and a page's text, both
 * to the wiki's MediaWiki API with fixed parameters: the caller supplies words, never a url, so
 * nothing can point this at another host. The requests carry no headers of their own.
 *
 * It is a polite client: one request at a time, a pause between them, a timeout, a size limit and a
 * cache, so a model asking the same thing twice costs the wiki one request.
 */

const API = 'https://warcraft.wiki.gg/api.php';
const PAGES = 'https://warcraft.wiki.gg/wiki/';

export const WIKI_LICENSE = 'Text from warcraft.wiki.gg, Creative Commons Attribution-ShareAlike 4.0; cite the page if you reuse it.';
export const WIKI_NOTE =
  'The wiki covers all of Warcraft and all expansions. This server is Wrath of the Lich King (3.3.5), so later events have not happened in its story yet. Later content is fair inspiration for new content; say where an idea comes from.';

export type WikiFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type WikiErrorKind = 'timeout' | 'network' | 'refused' | 'http' | 'missing' | 'too-large';

export class WikiError extends Error {
  constructor(
    readonly kind: WikiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'WikiError';
  }
}

export interface WikiClientOptions {
  fetch: WikiFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  minGapMs?: number;
  maxChars?: number;
  ttlMs?: number;
  maxEntries?: number;
}

const INTRO_LIMIT = 2000;
const SECTION_LIMIT = 6000;
const SEARCH_DEFAULT = 5;
const SEARCH_MAX = 10;

const cut = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit)}…` : text);

const ENTITIES: readonly [RegExp, string][] = [
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&amp;/g, '&'],
];
/** A search snippet's html as plain text. */
const plain = (html: string): string => ENTITIES.reduce((text, [pattern, to]) => text.replace(pattern, to), html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

const pageUrl = (title: string): string => PAGES + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');

interface Heading {
  heading: string;
  level: number;
  line: number;
}

const HEADING = /^(={2,6}) (.+?) \1\s*$/;

export function createWikiClient(options: WikiClientOptions) {
  const { fetch } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const minGapMs = options.minGapMs ?? 300;
  const maxChars = options.maxChars ?? 2_000_000;
  const ttlMs = options.ttlMs ?? 3_600_000;
  const maxEntries = options.maxEntries ?? 100;

  const cache = new Map<string, { at: number; value: unknown }>();
  let lastRequest: number | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  /** Requests run one at a time, in order. */
  const queued = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };

  /** One request, or the cached answer to it; the parsed JSON body. */
  const getJson = (params: Record<string, string>): Promise<any> =>
    queued(async () => {
      const url = `${API}?${new URLSearchParams(params).toString()}`;
      const hit = cache.get(url);
      if (hit && now() - hit.at < ttlMs) {
        cache.delete(url);
        cache.set(url, hit);
        return hit.value;
      }
      if (lastRequest !== null) {
        const wait = minGapMs - (now() - lastRequest);
        if (wait > 0) await sleep(wait);
      }
      lastRequest = now();

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Reject first: aborting makes the request fail too, and that must not be read as a network error
          reject(new WikiError('timeout', `The wiki did not answer within ${Math.round(timeoutMs / 1000)} seconds.`));
          controller.abort();
        }, timeoutMs);
      });
      let body: string;
      try {
        const response = await Promise.race([fetch(url, { signal: controller.signal }), timedOut]);
        if (!response.ok) {
          if ([403, 429, 503].includes(response.status)) {
            throw new WikiError('refused', `The wiki refused the request (HTTP ${response.status}); its protection may be blocking this program.`);
          }
          throw new WikiError('http', `The wiki answered with HTTP ${response.status}.`);
        }
        body = await Promise.race([response.text(), timedOut]);
      } catch (error) {
        if (error instanceof WikiError) throw error;
        throw new WikiError('network', `Could not reach the wiki: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
      }
      if (body.length > maxChars) throw new WikiError('too-large', 'The wiki answered with more text than this program will read.');
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        throw new WikiError('http', 'The wiki did not answer with data (it may be showing a challenge page).');
      }
      cache.set(url, { at: now(), value });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      return value;
    });

  return {
    async search(text: string, limit?: number): Promise<WikiSearchResult> {
      const count = Math.min(Math.max(Math.trunc(limit ?? SEARCH_DEFAULT), 1), SEARCH_MAX);
      const data = await getJson({ action: 'query', list: 'search', srsearch: text, srlimit: String(count), srnamespace: '0', format: 'json' });
      const hits: { title: string; snippet?: string }[] = data?.query?.search ?? [];
      return {
        results: hits.map((h) => ({ title: h.title, snippet: plain(h.snippet ?? ''), url: pageUrl(h.title) })),
        note: WIKI_NOTE,
        license: WIKI_LICENSE,
      };
    },

    async page(title: string, section?: string): Promise<WikiPageResult> {
      const data = await getJson({ action: 'query', prop: 'extracts', explaintext: '1', titles: title, redirects: '1', format: 'json' });
      const found = Object.values<any>(data?.query?.pages ?? {})[0];
      if (!found || 'missing' in found) {
        throw new WikiError('missing', `The wiki has no page called "${title}". Try wiki_search to find the right title.`);
      }
      const lines = String(found.extract ?? '').split('\n');
      const headings: Heading[] = [];
      lines.forEach((text, line) => {
        const m = HEADING.exec(text);
        if (m) headings.push({ heading: m[2]!.trim(), level: m[1]!.length, line });
      });
      const intro = lines.slice(0, headings[0]?.line ?? lines.length).join('\n').trim();

      let chosen: WikiPageResult['section'] = null;
      if (section !== undefined) {
        const index = headings.findIndex((h) => h.heading.toLowerCase() === section.trim().toLowerCase());
        if (index < 0) {
          throw new WikiError('missing', `"${found.title}" has no section "${section}". Its sections are: ${headings.map((h) => h.heading).join(', ') || '(none)'}.`);
        }
        const start = headings[index]!;
        const next = headings.slice(index + 1).find((h) => h.level <= start.level);
        chosen = { heading: start.heading, text: cut(lines.slice(start.line + 1, next?.line ?? lines.length).join('\n').trim(), SECTION_LIMIT) };
      }
      return {
        title: found.title,
        url: pageUrl(found.title),
        redirectedFrom: data?.query?.redirects?.[0]?.from ?? null,
        intro: cut(intro, INTRO_LIMIT),
        sections: headings.map((h) => ({ heading: h.heading, level: h.level })),
        section: chosen,
        note: WIKI_NOTE,
        license: WIKI_LICENSE,
      };
    },
  };
}
