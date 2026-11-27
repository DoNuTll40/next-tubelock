'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';

export function DescriptionHashtag({ children }) {
  return (
    <Link
      href={`/hashtag/${encodeURIComponent(children.slice(1))}`}
      onClick={event => event.stopPropagation()}
      className="mx-0.5 cursor-pointer font-medium text-[#FF7A00] hover:underline"
    >
      {children}
    </Link>
  );
}

export function DescriptionTimestamp({ children, label, seconds, onSeek }) {
  const classes = 'mx-0.5 inline-flex h-[20px] select-none items-center gap-1 rounded bg-[#065FD4]/10 px-1.5 py-0 align-[-2px] font-mono text-[11.5px] font-semibold text-[#065FD4] dark:text-[#3EA6FF]';
  const content = <><Clock aria-hidden="true" className="inline-block size-2.5 opacity-70" />{children}</>;

  if (typeof onSeek !== 'function') return <span className={classes}>{content}</span>;

  return (
    <button
      type="button"
      className={`${classes} cursor-pointer transition hover:bg-[#065FD4]/20 hover:underline`}
      title={`กระโดดไปที่ ${label}`}
      onClick={event => { event.stopPropagation(); onSeek(seconds); }}
    >
      {content}
    </button>
  );
}
