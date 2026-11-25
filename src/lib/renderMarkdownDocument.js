import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const markdownHtmlPolicy = {
  allowedTags: [
    'a', 'blockquote', 'br', 'code', 'del', 'details', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 's', 'strong', 'summary', 'table', 'tbody', 'td',
    'tfoot', 'th', 'thead', 'tr', 'ul',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    input: ['type', 'checked', 'disabled'],
    ol: ['start'],
    td: ['align'],
    th: ['align'],
  },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowedSchemesByTag: { img: ['https', 'http'] },
  allowProtocolRelative: false,
  transformTags: {
    input: (_tagName, attributes) => ({
      tagName: 'input',
      attribs: {
        type: 'checkbox',
        disabled: '',
        ...(Object.hasOwn(attributes, 'checked') ? { checked: '' } : {}),
      },
    }),
  },
};

function decodeHtmlEntities(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };
  return text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_entity, key) => entities[key]);
}

export function renderMarkdownDocument(markdown) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const rendered = marked.parse(body, { gfm: true, breaks: true });
  const sanitized = sanitizeHtml(rendered, markdownHtmlPolicy);
  const toc = [];
  const usedIds = new Set();

  const html = sanitized.replace(/<h2>([\s\S]*?)<\/h2>/gi, (_heading, headingInner) => {
    const title = decodeHtmlEntities(headingInner.replace(/<[^>]+>/g, '')).trim();
    const slug = title.toLowerCase().replace(/[^\w\u0E00-\u0E7F]+/g, '-').replace(/^-+|-+$/g, '');
    const baseId = slug || `section-${toc.length + 1}`;
    let id = baseId;
    for (let suffix = 2; usedIds.has(id); suffix++) id = `${baseId}-${suffix}`;
    usedIds.add(id);
    toc.push({ id, title });
    return `<h2 id="${id}" class="scroll-mt-20">${headingInner}</h2>`;
  });

  return { html, toc };
}
