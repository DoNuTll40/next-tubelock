import { Suspense } from 'react';
import ResultsClient from './ResultsClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const query = params?.search_query ? decodeURIComponent(params.search_query.replace(/\+/g, ' ')) : '';
  return {
    title: query ? `${query} - TubeLock` : 'ค้นหา - TubeLock',
    description: 'ผลการค้นหาวิดีโอบน TubeLock',
  };
}

export default async function ResultsPage({ searchParams }) {
  const params = await searchParams;
  const initialQuery = params?.search_query
    ? decodeURIComponent(params.search_query.replace(/\+/g, ' '))
    : '';

  return (
    <Suspense fallback={<ResultsSkeleton />}>
      <ResultsClient initialQuery={initialQuery} />
    </Suspense>
  );
}

function ResultsSkeleton() {
  return (
    <div className="w-full max-w-[1280px] mx-auto px-4 md:px-6 py-4">
      {/* Category Chips Skeleton */}
      <div className="flex gap-2.5 pb-4 overflow-hidden">
        {[80, 70, 90, 65, 75, 110].map((w, idx) => (
          <div
            key={idx}
            className="h-8 rounded-lg bg-black/5 dark:bg-white/5 animate-pulse shrink-0"
            style={{ width: `${w}px` }}
          />
        ))}
      </div>

      {/* Video Cards Skeleton */}
      <div className="flex flex-col gap-4 mt-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col sm:flex-row gap-4 animate-pulse">
            <div className="w-full sm:w-[360px] md:w-[420px] lg:w-[480px] aspect-video rounded-2xl bg-black/5 dark:bg-white/5 shrink-0" />
            <div className="flex-1 flex flex-col gap-2.5 py-1">
              <div className="h-5 w-4/5 rounded bg-black/5 dark:bg-white/5" />
              <div className="h-3 w-1/3 rounded bg-black/5 dark:bg-white/5" />
              <div className="flex items-center gap-2 mt-2">
                <div className="w-6 h-6 rounded-full bg-black/5 dark:bg-white/5 shrink-0" />
                <div className="h-3.5 w-28 rounded bg-black/5 dark:bg-white/5" />
              </div>
              <div className="h-3 w-3/5 rounded bg-black/5 dark:bg-white/5 mt-1" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
