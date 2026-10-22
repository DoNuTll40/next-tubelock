import { notFound } from 'next/navigation';
import { getDocBySlug, getAllDocs } from '@/lib/docs';
import MarkdownDocViewer from '@/components/docs/MarkdownDocViewer';

export async function generateStaticParams() {
  const docs = await getAllDocs();
  return docs.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);
  if (!doc) return { title: 'TubeLock Docs' };

  const title = `${doc.title} - TubeLock`;
  const description = doc.metadata?.description || `เอกสาร ${doc.title} แพลตฟอร์ม TubeLock`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/tubelock/${slug}`,
      siteName: 'TubeLock',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
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
      updatedAt={doc.updatedAt}
      prevPage={doc.prevDoc ? { href: doc.prevDoc.href, title: doc.prevDoc.title } : null}
      nextPage={doc.nextDoc ? { href: doc.nextDoc.href, title: doc.nextDoc.title } : null}
    />
  );
}
