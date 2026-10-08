import { describe, expect, it } from 'vitest';
import { WIKI_LICENSE, WIKI_NOTE, WikiError, createWikiClient, type WikiFetch } from '../../src/core/lore/wiki';

const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

const SEARCH = {
  query: { search: [
    { ns: 0, title: 'Goldshire', snippet: 'Humans <span class="searchmatch">Goldshire</span> is a town &quot;x&quot; &amp; more' },
    { ns: 0, title: 'Elwynn Forest', snippet: 'adventurers.' },
  ] },
};
const EXTRACT = [
  'Goldshire is a human town in Elwynn Forest.', '',
  '== History ==', 'Old days.', '',
  '=== Before the Great Wars ===', 'Long ago.', '',
  '=== Wrath of the Lich King ===', 'Scourge came.', '',
  '== Notable characters ==', 'Marshal Dughan.',
].join('\n');
const page = (over: Record<string, unknown> = {}) => ({ query: { pages: { '11461': { pageid: 11461, title: 'Goldshire', extract: EXTRACT, ...over } } } });

function clock() {
  const state = { t: 0, sleeps: [] as number[] };
  return { state, now: () => state.t, sleep: async (ms: number) => { state.sleeps.push(ms); state.t += ms; } };
}
function setup(handler: (url: string) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>, options: Partial<Parameters<typeof createWikiClient>[0]> = {}) {
  const calls: { url: string; init: unknown }[] = [];
  const fetch: WikiFetch = async (url, init) => { calls.push({ url, init }); return handler(url); };
  const c = clock();
  const client = createWikiClient({ fetch, now: c.now, sleep: c.sleep, ...options });
  return { client, calls, clock: c };
}

describe('wiki search', () => {
  it('returns titles, plain snippets and page urls, with the notes', async () => {
    const { client, calls } = setup(() => reply(SEARCH));
    const out = await client.search('Goldshire', 3);
    expect(out.results).toEqual([
      { title: 'Goldshire', snippet: 'Humans Goldshire is a town "x" & more', url: 'https://warcraft.wiki.gg/wiki/Goldshire' },
      { title: 'Elwynn Forest', snippet: 'adventurers.', url: 'https://warcraft.wiki.gg/wiki/Elwynn_Forest' },
    ]);
    expect(out.note).toBe(WIKI_NOTE);
    expect(out.license).toBe(WIKI_LICENSE);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('list')).toBe('search');
    expect(url.searchParams.get('srsearch')).toBe('Goldshire');
    expect(url.searchParams.get('srlimit')).toBe('3');
  });

  it('defaults the limit to 5 and clamps it to 1..10', async () => {
    const { client, calls } = setup(() => reply(SEARCH));
    await client.search('a');
    await client.search('b', 50);
    await client.search('c', 0);
    expect(calls.map((c) => new URL(c.url).searchParams.get('srlimit'))).toEqual(['5', '10', '1']);
  });
});

describe('wiki page', () => {
  it('splits a page into its intro and sections, and returns the one asked for with its sub-sections', async () => {
    const { client, calls } = setup(() => reply(page()));
    const out = await client.page('Goldshire', 'history');
    expect(out.title).toBe('Goldshire');
    expect(out.url).toBe('https://warcraft.wiki.gg/wiki/Goldshire');
    expect(out.intro).toBe('Goldshire is a human town in Elwynn Forest.');
    expect(out.sections).toEqual([
      { heading: 'History', level: 2 }, { heading: 'Before the Great Wars', level: 3 },
      { heading: 'Wrath of the Lich King', level: 3 }, { heading: 'Notable characters', level: 2 },
    ]);
    expect(out.section?.heading).toBe('History');
    expect(out.section?.text).toContain('Old days.');
    expect(out.section?.text).toContain('Scourge came.');
    expect(out.section?.text).not.toContain('Marshal Dughan.');
    expect(new URL(calls[0]!.url).searchParams.get('titles')).toBe('Goldshire');
  });

  it('without a section returns the intro and the heading list only', async () => {
    const { client } = setup(() => reply(page()));
    const out = await client.page('Goldshire');
    expect(out.section).toBeNull();
    expect(out.sections).toHaveLength(4);
  });

  it('cuts a long intro at 2000 characters and a long section at 6000, marking the cut', async () => {
    const long = `${'a'.repeat(2500)}\n== Big ==\n${'b'.repeat(7000)}`;
    const { client } = setup(() => reply(page({ extract: long })));
    const out = await client.page('Goldshire', 'Big');
    expect(out.intro).toHaveLength(2001);
    expect(out.intro.endsWith('…')).toBe(true);
    expect(out.section!.text).toHaveLength(6001);
  });

  it('reports a redirect', async () => {
    const body = { query: { redirects: [{ from: 'Goldshire Inn', to: "Lion's Pride Inn" }], pages: { '5': { pageid: 5, title: "Lion's Pride Inn", extract: 'An inn.' } } } };
    const { client } = setup(() => reply(body));
    const out = await client.page('Goldshire Inn');
    expect(out.redirectedFrom).toBe('Goldshire Inn');
    expect(out.title).toBe("Lion's Pride Inn");
    expect(out.url).toBe("https://warcraft.wiki.gg/wiki/Lion's_Pride_Inn");
  });

  it('says a missing page is missing, and a missing section lists the headings', async () => {
    const gone = setup(() => reply({ query: { pages: { '-1': { title: 'Nope', missing: '' } } } }));
    await expect(gone.client.page('Nope')).rejects.toMatchObject({ kind: 'missing', message: expect.stringMatching(/wiki_search/) });
    const { client } = setup(() => reply(page()));
    await expect(client.page('Goldshire', 'Economy')).rejects.toMatchObject({ kind: 'missing', message: expect.stringMatching(/History/) });
  });
});

describe('wiki failures', () => {
  it.each([[403, 'refused'], [429, 'refused'], [503, 'refused'], [500, 'http'], [404, 'http']] as const)('treats HTTP %i as %s', async (status, kind) => {
    const { client } = setup(() => reply('nope', status));
    const error = await client.search('x').catch((e) => e);
    expect(error).toBeInstanceOf(WikiError);
    expect(error.kind).toBe(kind);
    if (kind === 'refused') expect(error.message).toMatch(/refused/i);
  });

  it('turns a rejected fetch into a network error', async () => {
    const client = createWikiClient({ fetch: async () => { throw new Error('offline'); } });
    await expect(client.search('x')).rejects.toMatchObject({ kind: 'network' });
  });

  it('gives up on a request that does not answer, and aborts it', async () => {
    let aborted = false;
    const fetch: WikiFetch = (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }); });
    const client = createWikiClient({ fetch, timeoutMs: 20, sleep: async () => {} });
    await expect(client.search('x')).rejects.toMatchObject({ kind: 'timeout' });
    expect(aborted).toBe(true);
  });

  it('refuses an answer that is too large, and one that is not JSON', async () => {
    const big = setup(() => reply('x'.repeat(200)), { maxChars: 100 });
    await expect(big.client.search('x')).rejects.toMatchObject({ kind: 'too-large' });
    const junk = setup(() => reply('<html>challenge</html>'));
    await expect(junk.client.search('x')).rejects.toMatchObject({ kind: 'http' });
  });
});

describe('wiki requests', () => {
  it('only ever go to warcraft.wiki.gg/api.php, whatever the text, and carry no headers', async () => {
    const { client, calls } = setup(() => reply(page()));
    await client.search('https://evil.example/x?y=1#z');
    await client.page('https://evil.example/steal');
    await client.page('../../etc/passwd');
    for (const { url, init } of calls) {
      const u = new URL(url);
      expect(u.protocol).toBe('https:');
      expect(u.host).toBe('warcraft.wiki.gg');
      expect(u.pathname).toBe('/api.php');
      expect(Object.keys(init as object)).toEqual(['signal']);
    }
  });

  it('wait at least 300 ms between real requests', async () => {
    const { client, clock: c } = setup(() => reply(SEARCH));
    await client.search('a');
    c.state.t = 100;
    await client.search('b');
    expect(c.state.sleeps).toEqual([200]);
  });

  it('answer a repeat from the cache without asking again, until an hour has passed', async () => {
    const { client, calls, clock: c } = setup(() => reply(SEARCH));
    await client.search('a');
    await client.search('a');
    expect(calls).toHaveLength(1);
    c.state.t += 3_600_001;
    await client.search('a');
    expect(calls).toHaveLength(2);
  });

  it('keep only the most recently used entries', async () => {
    const { client, calls } = setup(() => reply(SEARCH), { maxEntries: 2 });
    await client.search('a');
    await client.search('b');
    await client.search('c');
    await client.search('a');
    expect(calls).toHaveLength(4);
  });

  it('do not cache a failure', async () => {
    let status = 500;
    const { client, calls } = setup(() => reply(SEARCH, status));
    await client.search('a').catch(() => undefined);
    status = 200;
    await client.search('a');
    expect(calls).toHaveLength(2);
  });
});
