import site from '../../data/site.json';
import notes from '../../data/notes.json';

export async function GET() {
  const items = notes.entries.map((entry) => {
    const slug = entry.id.replace(/^n-/, '');
    return `    <item>
      <title>${entry.datelabel} ${entry.author}</title>
      <link>${site.siteUrl}/notes/${slug}/</link>
      <guid isPermaLink="true">${site.siteUrl}/notes/${slug}/</guid>
      <pubDate>${new Date(entry.datetime).toUTCString()}</pubDate>
      <description><![CDATA[${entry.html}]]></description>
    </item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${site.brand} · 随想</title>
    <link>${site.siteUrl}/notes</link>
    <description>${notes.lede}</description>
    <language>zh-CN</language>
${items.join('\n')}
  </channel>
</rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
