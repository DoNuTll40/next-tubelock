import fs from 'fs/promises';
import path from 'path';

const DOCS_DIR = path.join(process.cwd(), 'docs');

/**
 * Parse frontmatter and content from markdown string
 */
function parseFrontmatter(rawContent) {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = rawContent.match(fmRegex);

  const metadata = {};
  let content = rawContent;

  if (match) {
    const rawFm = match[1];
    content = match[2];

    rawFm.split('\n').forEach((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        metadata[key] = value;
      }
    });
  }

  // If title not in frontmatter, extract first # Heading
  if (!metadata.title) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      metadata.title = h1Match[1].trim();
    }
  }

  return { metadata, content };
}

/**
 * Get all available documents dynamically from docs/
 */
export async function getAllDocs() {
  try {
    const files = await fs.readdir(DOCS_DIR);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    const docs = await Promise.all(
      mdFiles.map(async (fileName) => {
        const slug = fileName.replace(/\.md$/, '');
        const filePath = path.join(DOCS_DIR, fileName);
        const rawContent = await fs.readFile(filePath, 'utf-8');
        const { metadata } = parseFrontmatter(rawContent);

        // Group inference if not explicitly provided
        let group = metadata.group;
        if (!group) {
          if (slug === 'policy' || slug === 'terms') {
            group = 'นโยบายและข้อกำหนด (LEGAL)';
          } else if (slug === 'faq') {
            group = 'ศูนย์ช่วยเหลือและข้อมูล';
          } else {
            group = 'เอกสารทั่วไป (General)';
          }
        }

        const title = metadata.title || slug;
        const order = metadata.order ? parseInt(metadata.order, 10) : 99;

        return {
          slug,
          fileName,
          title,
          group,
          order,
          href: `/tubelock/${slug}`,
          docPath: `docs/${fileName}`,
        };
      })
    );

    // Sort docs by order, then by title
    docs.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.title.localeCompare(b.title, 'th');
    });

    return docs;
  } catch (err) {
    console.error('Error reading docs directory:', err);
    return [];
  }
}

/**
 * Get grouped navigation tree dynamically
 */
export async function getDocsNav() {
  const docs = await getAllDocs();
  const groupsMap = new Map();

  docs.forEach((doc) => {
    if (!groupsMap.has(doc.group)) {
      groupsMap.set(doc.group, []);
    }
    groupsMap.get(doc.group).push(doc);
  });

  return Array.from(groupsMap.entries()).map(([group, items]) => ({
    group,
    items,
  }));
}

/**
 * Get a single document by its slug
 */
export async function getDocBySlug(slug) {
  const allDocs = await getAllDocs();
  const currentIndex = allDocs.findIndex((d) => d.slug === slug);

  if (currentIndex === -1) {
    return null;
  }

  const currentDoc = allDocs[currentIndex];
  const filePath = path.join(DOCS_DIR, currentDoc.fileName);
  const rawContent = await fs.readFile(filePath, 'utf-8');
  const { metadata, content } = parseFrontmatter(rawContent);

  const prevDoc = currentIndex > 0 ? allDocs[currentIndex - 1] : null;
  const nextDoc = currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : null;

  return {
    ...currentDoc,
    metadata,
    content,
    prevDoc,
    nextDoc,
  };
}
