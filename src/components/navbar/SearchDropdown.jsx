'use client';

import React, { useState, useEffect, useRef } from 'react';
import { History, Search, X } from 'lucide-react';

// Default initial search history matching YouTube style & local database videos
const DEFAULT_HISTORY = [];

export default function SearchDropdown({
  isOpen,
  searchQuery,
  onSelectQuery,
  onClose,
  searchContainerRef,
}) {
  const [history, setHistory] = useState([]);
  const [videos, setVideos] = useState([]);
  const [canScrollMore, setCanScrollMore] = useState(true);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const dropdownRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const checkScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    setCanScrollUp(scrollTop > 6);
    setCanScrollMore(scrollHeight - scrollTop - clientHeight > 6);
  };

  const getMaskStyle = () => {
    if (canScrollUp && canScrollMore) {
      return 'linear-gradient(to bottom, transparent 0%, black 24px, black calc(100% - 44px), transparent 100%)';
    }
    if (canScrollMore) {
      return 'linear-gradient(to bottom, black 0%, black calc(100% - 44px), transparent 100%)';
    }
    if (canScrollUp) {
      return 'linear-gradient(to bottom, transparent 0%, black 24px, black 100%)';
    }
    return 'none';
  };

  useEffect(() => {
    const timer = setTimeout(checkScroll, 60);
    return () => clearTimeout(timer);
  }, [history, videos, searchQuery, isOpen]);

  // Load history: instant localStorage cache + account database sync
  useEffect(() => {
    let cancelled = false;

    // 1. Initial fast load from localStorage or default
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tubelock_search_history');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setHistory(parsed);
          } else {
            setHistory(DEFAULT_HISTORY);
          }
        } else {
          setHistory(DEFAULT_HISTORY);
        }
      } catch (_) {
        setHistory(DEFAULT_HISTORY);
      }
    }

    // 2. Fetch Account-specific search history from PostgreSQL DB
    fetch('/api/search/history')
      .then((res) => res.json())
      .then((res) => {
        if (cancelled) return;
        if (res?.success && res.loggedIn && Array.isArray(res.data) && res.data.length > 0) {
          // Enrich with default thumbnails if missing
          const enrichedDb = res.data.map((item) => {
            if (item.thumbnail) return item;
            const def = DEFAULT_HISTORY.find(
              (d) => d.query.toLowerCase() === item.query.toLowerCase()
            );
            return def?.thumbnail ? { ...item, thumbnail: def.thumbnail } : item;
          });

          // Merge: account DB items first, followed by defaults not yet in account
          const existingQueries = new Set(enrichedDb.map((p) => p.query.toLowerCase()));
          const missingDefaults = DEFAULT_HISTORY.filter(
            (d) => !existingQueries.has(d.query.toLowerCase())
          );
          const merged = [...enrichedDb, ...missingDefaults];
          setHistory(merged);
          try {
            localStorage.setItem('tubelock_search_history', JSON.stringify(merged));
          } catch (_) { }
        }
      })
      .catch(() => { });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch available videos from database to enrich suggestions with real thumbnails
  useEffect(() => {
    let cancelled = false;
    fetch('/api/videos')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.data && Array.isArray(data.data)) {
          setVideos(
            data.data.map((v) => ({
              id: v.id,
              title: v.title || '',
              thumbnail: v.thumbnail_url || (v.id ? `/streams/stream_vid_${v.id}/poster.jpg` : null),
            }))
          );
        }
      })
      .catch(() => { });

    return () => {
      cancelled = true;
    };
  }, []);

  // Save history to localStorage
  const saveHistory = (newHistory) => {
    setHistory(newHistory);
    try {
      localStorage.setItem('tubelock_search_history', JSON.stringify(newHistory));
    } catch (_) { }
  };

  // Remove single item from history (Local + Account Database)
  const handleRemoveItem = (e, idToRemove) => {
    e.stopPropagation();
    const itemToRemove = history.find((item) => item.id === idToRemove);
    const updated = history.filter((item) => item.id !== idToRemove);
    saveHistory(updated);

    // Call DELETE API in background to remove from user's account database
    if (itemToRemove) {
      const deleteParams = new URLSearchParams();
      if (itemToRemove.dbId) deleteParams.set('id', String(itemToRemove.dbId));
      deleteParams.set('query', itemToRemove.query);
      fetch(`/api/search/history?${deleteParams.toString()}`, { method: 'DELETE' }).catch(() => { });
    }
  };

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        searchContainerRef?.current &&
        !searchContainerRef.current.contains(e.target)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen, onClose, searchContainerRef]);

  if (!isOpen) return null;

  // Filter items based on user query
  const trimmedQuery = searchQuery.trim().toLowerCase();
  let displayedItems = [];

  if (!trimmedQuery) {
    // When input is empty: show recent search history
    displayedItems = history.slice(0, 20);
  } else {
    // When input has text:
    // 1. Matching history items
    const matchingHistory = history.filter((item) =>
      item.query.toLowerCase().includes(trimmedQuery)
    );

    // 2. Matching video titles from database
    const matchingVideos = videos
      .filter((v) => v.title.toLowerCase().includes(trimmedQuery))
      .filter((v) => !matchingHistory.some((h) => h.query.toLowerCase() === v.title.toLowerCase()))
      .map((v) => ({
        id: `vid_${v.id}`,
        query: v.title,
        thumbnail: v.thumbnail,
        isSuggestion: true,
      }));

    displayedItems = [...matchingHistory, ...matchingVideos].slice(0, 15);

    // If still empty, add current typed query as first suggestion
    if (displayedItems.length === 0) {
      displayedItems = [
        {
          id: 'typed_current',
          query: searchQuery,
          thumbnail: null,
          isSuggestion: true,
        },
      ];
    }
  }

  const resolveThumbnail = (item) => {
    if (item.thumbnail) return item.thumbnail;
    const def = DEFAULT_HISTORY.find(
      (d) => d.query.toLowerCase() === item.query.toLowerCase()
    );
    if (def?.thumbnail) return def.thumbnail;

    const vMatch = videos.find(
      (v) =>
        v.title.toLowerCase().includes(item.query.toLowerCase()) ||
        item.query.toLowerCase().includes(v.title.toLowerCase())
    );
    return vMatch?.thumbnail || null;
  };

  if (displayedItems.length === 0) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute top-[calc(100%+6px)] left-0 right-0 z-[60] bg-white/98 dark:bg-[#212121]/98 rounded-2xl shadow-[0_16px_36px_rgba(0,0,0,0.45)] overflow-hidden animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      {/* Scrollable list (Hidden scrollbar + YouTube-style Edge Fade Gradient Mask) */}
      <div
        ref={scrollContainerRef}
        onScroll={checkScroll}
        style={{
          maskImage: getMaskStyle(),
          WebkitMaskImage: getMaskStyle(),
        }}
        className="py-2.5 px-2.5 max-h-[min(850px,65vh)] overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex flex-col">
          {displayedItems.map((item) => {
            const isHistoryItem = !item.isSuggestion;
            const thumbnail = resolveThumbnail(item);

            return (
              <div
                key={item.id}
                onClick={() => onSelectQuery(item.query, thumbnail)}
                className="group flex items-center justify-between pl-4 pr-2 min-h-[46px] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer rounded-lg"
              >
                {/* Left: Icon + Query Text */}
                <div className="flex items-center gap-3.5 flex-1 min-w-0 pr-3">
                  {isHistoryItem ? (
                    <History className="w-[18px] h-[18px] text-[#8C857B] dark:text-[#AAAAAA] group-hover:text-[#212529] dark:group-hover:text-white shrink-0" />
                  ) : (
                    <Search className="w-[18px] h-[18px] text-[#8C857B] dark:text-[#AAAAAA] group-hover:text-[#212529] dark:group-hover:text-white shrink-0" />
                  )}

                  <span className="text-md font-medium text-[#212529] dark:text-[#F1F1F1] truncate leading-tight">
                    {item.query}
                  </span>
                </div>

                {/* Right: Video Thumbnail Preview + Remove Button */}
                <div className="flex items-center gap-1 shrink-0">
                  {thumbnail && (
                    <div className="w-14 h-8 sm:w-16 sm:h-9 rounded-md overflow-hidden bg-black/20 shrink-0 border border-black/10 dark:border-white/10 shadow-xs">
                      <img
                        src={thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}

                  {/* Remove button (X) for history items on hover */}
                  {isHistoryItem && (
                    <button
                      type="button"
                      onClick={(e) => handleRemoveItem(e, item.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/20 text-[#8C857B] hover:text-[#212529] dark:text-[#AAAAAA] dark:hover:text-white transition cursor-pointer"
                      title="ลบออกจากประวัติการค้นหา"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
