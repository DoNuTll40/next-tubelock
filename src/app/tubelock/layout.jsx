import { getDocsNav } from '@/lib/docs';
import TubelockDocsShell from '@/components/docs/TubelockDocsShell';

export default async function TubelockDocsLayout({ children }) {
  // Dynamically scan docs/*.md files to build navigation tree
  const nav = await getDocsNav();

  return (
    <TubelockDocsShell nav={nav}>
      {children}
    </TubelockDocsShell>
  );
}
