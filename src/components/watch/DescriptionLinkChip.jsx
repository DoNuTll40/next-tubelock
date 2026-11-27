'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

const CHANNEL_ALIAS_MAP = {
  'UCSrC9Jb_eUeQkpVn2OfRauw': '@theetrexofficial',
};

/**
 * Recognizes and extracts social media info from URL (TikTok, YouTube, Facebook, Instagram, etc.)
 */
function getSocialLinkInfo(parsed) {
  try {
    const host = parsed.hostname.replace(/^www\./, '');
    const pathname = decodeURIComponent(parsed.pathname);

    // 1. TikTok: tiktok.com/@teerapong_6 or tiktok.com/@username
    if (host.includes('tiktok.com')) {
      const match = pathname.match(/^\/@?([a-zA-Z0-9_.-]+)/);
      const username = match ? match[1] : pathname.replace(/^\//, '');
      return {
        label: username ? `/ ${username}` : '/ tiktok',
      };
    }

    // 2. YouTube: youtube.com/@theetrexofficial, youtube.com/channel/..., youtu.be/...
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      if (pathname.startsWith('/@')) {
        return {
          label: `/ ${pathname.slice(1).split('/')[0]}`,
        };
      }
      if (pathname.includes('/channel/') || pathname.includes('/c/') || pathname.includes('/user/')) {
        const parts = pathname.split('/').filter(Boolean);
        const name = parts[parts.length - 1] || 'channel';
        const alias = CHANNEL_ALIAS_MAP[name];
        const display = alias || (name.startsWith('@') ? name : (name.length > 18 ? `${name.slice(0, 15)}...` : name));
        return {
          label: `/ ${display}`,
        };
      }
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        label: clean ? `/ ${clean}` : '/ youtube',
      };
    }

    // 3. Facebook: facebook.com/theetrexfanpage or fb.com/...
    if (host.includes('facebook.com') || host.includes('fb.com') || host.includes('fb.me')) {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        label: clean ? `/ ${clean}` : '/ facebook',
      };
    }

    // 4. Instagram: instagram.com/teerapong_6
    if (host.includes('instagram.com')) {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        label: clean ? `/ ${clean}` : '/ instagram',
      };
    }

    // 5. Twitter / X: twitter.com/username or x.com/username
    if (host === 'twitter.com' || host === 'x.com') {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        label: clean ? `/ @${clean}` : '/ x',
      };
    }

    // 6. Spotify
    if (host.includes('spotify.com')) {
      return {
        label: '/ spotify',
      };
    }

    // 7. LINE
    if (host.includes('line.me')) {
      return {
        label: '/ line',
      };
    }

    return null;
  } catch {
    return null;
  }
}

function LinkFavicon({ hostname }) {
  const [attempt, setAttempt] = useState(0);
  const isDomain = /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(hostname);

  if (!isDomain || attempt >= 2) {
    return <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />;
  }

  const alternateHost = hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`;
  const iconHost = attempt === 0 ? hostname : alternateHost;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://a.favicon.im/${encodeURIComponent(iconHost)}?throw-error-on-404=true`}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setAttempt(attempt + 1)}
      className="size-3.5 shrink-0 rounded-sm object-contain"
    />
  );
}

export function parseDescriptionLink(href) {
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isUrlLabel(label, url) {
  const text = label.trim();
  if (parseDescriptionLink(text)?.href === url.href) return true;
  // The editor can auto-link a domain typed without a protocol.
  return !text.includes('://') && parseDescriptionLink(url.protocol + '//' + text)?.href === url.href;
}

export default function DescriptionLinkChip({ href, url, label, children }) {
  const isWebLink = url.protocol === 'https:' || url.protocol === 'http:';
  const social = isWebLink ? getSocialLinkInfo(url) : null;
  let display = children;
  if (isWebLink && (label === undefined || isUrlLabel(label, url))) {
    const host = url.hostname.replace(/^www\./, '');
    const path = url.pathname.length > 1 ? url.pathname.slice(0, 15) : '';
    display = social?.label ?? host + path;
  }

  return (
    <a
      data-description-link-chip=""
      href={href}
      target={isWebLink ? '_blank' : undefined}
      rel="noopener noreferrer"
      onClick={event => event.stopPropagation()}
      className={`inline-flex max-w-[calc(100%-0.5rem)] items-center rounded-full bg-[#0000000a] px-2 py-0 mx-1 h-[21px] text-[12px] font-normal transition align-[-3px] hover:bg-[#00000014] dark:bg-white/10 dark:hover:bg-white/20 ${social
        ? 'gap-1.5 cursor-pointer select-none text-[#0F0F0F] dark:text-[#F1F1F1]'
        : 'gap-1 text-[#065FD4] dark:text-[#3EA6FF]'
      }`}
      title={href}
    >
      <LinkFavicon key={url.hostname} hostname={url.hostname} />
      <span className={social
        ? 'min-w-0 truncate tracking-tight'
        : 'min-w-0 max-w-[200px] truncate hover:underline'
      }>{display}</span>
    </a>
  );
}
