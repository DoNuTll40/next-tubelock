import { notFound } from 'next/navigation';
import { getDocBySlug, getAllDocs } from '@/lib/docs';
import MarkdownDocViewer from '@/components/docs/MarkdownDocViewer';

export async function generateStaticParams() {
  const docs = await getAllDocs();
  return docs.map((doc) => ({ slug: doc.slug }));
}

export default async function DynamicDocPage({ params }) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) {
    notFound();
  }

  return (
    <MarkdownDocViewer
      docSlug={doc.slug}
      docPath={doc.docPath}
      title={doc.title}
      category={doc.group}
      prevPage={doc.prevDoc ? { href: doc.prevDoc.href, title: doc.prevDoc.title } : null}
      nextPage={doc.nextDoc ? { href: doc.nextDoc.href, title: doc.nextDoc.title } : null}
    />
  );
}
