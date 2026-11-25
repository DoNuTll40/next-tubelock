import { notFound } from 'next/navigation';
import { getSessionUserId, isAdmin } from '@/lib/access';
import BenchmarkClient from './BenchmarkClient';

export default async function BenchmarkPage() {
  if (!isAdmin(await getSessionUserId())) notFound();

  return <BenchmarkClient />;
}
