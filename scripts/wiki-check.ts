/**
 * A manual check that the wiki client is not turned away by https://warcraft.wiki.gg: it searches,
 * reads a page and one of its sections with the program's default request (no headers of its own).
 * Not part of the test suite; the suite never touches the network.
 *
 *   npx tsx scripts/wiki-check.ts
 */
import { WikiError, createWikiClient } from '../src/core/lore/wiki';

const client = createWikiClient({ fetch: (url, init) => fetch(url, init) });
const first = (text: string, lines = 4): string => text.split('\n').slice(0, lines).join('\n');

try {
  const search = await client.search('Goldshire', 3);
  console.log('SEARCH Goldshire');
  for (const r of search.results) console.log(`  ${r.title}  ${r.url}\n    ${r.snippet.slice(0, 100)}`);

  const page = await client.page('Goldshire', 'History');
  console.log(`\nPAGE ${page.title}  ${page.url}`);
  console.log(`  intro: ${first(page.intro, 2).slice(0, 200)}`);
  console.log(`  sections: ${page.sections.map((s) => s.heading).slice(0, 8).join(', ')}`);
  console.log(`  History: ${first(page.section?.text ?? '', 3).slice(0, 300)}`);
  console.log('\nOK: the wiki answered the default client.');
} catch (error) {
  if (error instanceof WikiError) {
    console.error(`\nFAILED (${error.kind}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
