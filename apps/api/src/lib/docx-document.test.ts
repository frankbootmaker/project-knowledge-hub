import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDocxDocumentHtml,
  buildDocxDocumentOptions,
  inlineImageDataUris,
  normalizeDocumentXml,
  styleMarkdownHtmlForDocx,
} from './docx-document.js';

describe('styleMarkdownHtmlForDocx', () => {
  it('styles tables with a shaded header, zebra rows and column alignment', () => {
    const styled = styleMarkdownHtmlForDocx(
      [
        '<table><thead><tr><th align="right">Amount</th></tr></thead>',
        '<tbody><tr><td align="right">1</td></tr><tr><td align="right">2</td></tr></tbody></table>',
      ].join(''),
    );

    expect(styled).toContain('<table style="border-collapse:collapse;width:100%">');
    expect(styled).toContain('background-color:#F1F3F5');
    expect(styled).toMatch(/<th[^>]*font-weight:bold[^>]*text-align:right/);
    // Only the second body row is shaded, mirroring the viewer's zebra striping.
    expect(styled.match(/background-color:#FAFBFC/g)).toHaveLength(1);
  });

  it('shrinks cell text as tables get wider', () => {
    const cells = (count: number) =>
      Array.from({ length: count }, (_, index) => `<td>${index}</td>`).join('');
    const narrow = styleMarkdownHtmlForDocx(`<table><tbody><tr>${cells(3)}</tr></tbody></table>`);
    const wide = styleMarkdownHtmlForDocx(`<table><tbody><tr>${cells(20)}</tr></tbody></table>`);

    expect(narrow).toContain('font-size:9pt');
    expect(wide).toContain('font-size:7pt');
    expect(wide).not.toContain('font-size:9pt');
  });

  it('shades code blocks and keeps highlight.js colors', () => {
    const styled = styleMarkdownHtmlForDocx(
      '<pre><code class="language-ts"><span class="hljs-keyword">const</span></code></pre>',
    );

    expect(styled).toContain('background-color:#F4F5F7');
    expect(styled).toContain('font-family:Consolas');
    expect(styled).toContain('color:#D73A49');
  });

  it('styles inline code without spilling onto the paragraph', () => {
    const styled = styleMarkdownHtmlForDocx('<p>text <code>inline</code></p>');

    expect(styled).toContain('<p>');
    expect(styled).toMatch(/<code style="font-family:Consolas;background-color:#F4F5F7/);
  });

  it('carries quote styling on a run so Word keeps it', () => {
    const styled = styleMarkdownHtmlForDocx('<blockquote><p>quoted</p></blockquote>');

    expect(styled).toContain('<p><span style="color:#3A4149">quoted</span></p>');
  });

  it('drops images whose source was removed by sanitizing', () => {
    const styled = styleMarkdownHtmlForDocx(
      '<p><img alt="gone"></p><p><img src="https://x.dev/a.png" alt="kept"></p>',
    );

    expect(styled).not.toContain('alt="gone"');
    expect(styled).toContain('src="https://x.dev/a.png"');
  });
});

describe('buildDocxDocumentHtml', () => {
  it('opens with the record title and metadata', () => {
    const html = buildDocxDocumentHtml({
      title: 'Q3 & Q4',
      metaLine: 'note · draft · q3-q4',
      summary: 'Rolling summary',
      exportedNote: 'Exported now',
      bodyHtml: '<p>Body</p>',
    });

    expect(html).toContain('Q3 &amp; Q4');
    expect(html).toContain('note · draft · q3-q4');
    expect(html).toContain('<em>Rolling summary</em>');
  });
});

describe('buildDocxDocumentOptions', () => {
  it('turns landscape for spreadsheet-wide records', () => {
    expect(buildDocxDocumentOptions({ title: 'x', landscape: true }).orientation).toBe(
      'landscape',
    );
    expect(buildDocxDocumentOptions({ title: 'x', landscape: false }).orientation).toBe(
      'portrait',
    );
  });
});

describe('normalizeDocumentXml', () => {
  it('rounds fractional measurements Word rejects', () => {
    const xml = normalizeDocumentXml(
      '<w:tblGrid><w:gridCol w:w="1059.857142857143"/><w:gridCol w:w="1060"/></w:tblGrid>',
    );

    expect(xml).toContain('<w:gridCol w:w="1060"/><w:gridCol w:w="1060"/>');
    expect(xml).not.toMatch(/\d\.\d/);
  });

  it('keeps a single table grid, as the Word schema allows only one', () => {
    const xml = normalizeDocumentXml(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="10"/></w:tblGrid>' +
        '<w:tr><w:tc/></w:tr>' +
        '<w:tblGrid><w:gridCol w:w="10"/></w:tblGrid><w:tr><w:tc/></w:tr></w:tbl>',
    );

    expect(xml.match(/<w:tblGrid>/g)).toHaveLength(1);
    expect(xml).toContain('<w:tblPr/><w:tblGrid>');
  });

  it('repeats the header row of a table across pages', () => {
    const xml = normalizeDocumentXml(
      '<w:tbl><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr>' +
        '<w:shd w:val="clear" w:fill="F1F3F5"/></w:tcPr></w:tc></w:tr>' +
        '<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr/></w:tc></w:tr></w:tbl>',
    );

    expect(xml.match(/<w:tblHeader\/>/g)).toHaveLength(1);
    expect(xml).toContain('<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>');
  });

  it('leaves tables without a styled header row alone', () => {
    const xml = normalizeDocumentXml(
      '<w:tbl><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr/></w:tc></w:tr></w:tbl>',
    );

    expect(xml).not.toContain('<w:tblHeader/>');
  });
});

describe('inlineImageDataUris', () => {
  let server: Server;
  let origin = '';

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.headers.cookie !== 'kh_session=abc') {
        response.writeHead(401).end();
        return;
      }
      response
        .writeHead(200, { 'content-type': 'image/png' })
        .end(Buffer.from('89504e470d0a1a0a', 'hex'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(() => {
    server.close();
  });

  it('embeds private media using the caller session', async () => {
    const html = await inlineImageDataUris(`<p><img src="${origin}/a.png" alt="a"></p>`, {
      cookieHeader: 'kh_session=abc',
    });

    expect(html).toContain('src="data:image/png;base64,');
  });

  it('keeps the original source when the fetch is rejected', async () => {
    const html = await inlineImageDataUris(`<p><img src="${origin}/a.png" alt="a"></p>`);

    expect(html).toContain(`src="${origin}/a.png"`);
  });
});
