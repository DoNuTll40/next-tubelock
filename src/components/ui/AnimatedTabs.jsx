'use client';

import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { LayoutGroup, motion } from 'framer-motion';

const desktopQuery = '(min-width: 64rem)';
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const serverMediaMatch = () => false;

function subscribeToMedia(query, listener) {
  const media = window.matchMedia(query);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

const subscribeToDesktop = (listener) => subscribeToMedia(desktopQuery, listener);
const isDesktop = () => window.matchMedia(desktopQuery).matches;
const subscribeToReducedMotion = (listener) => subscribeToMedia(reducedMotionQuery, listener);
const prefersReducedMotion = () => window.matchMedia(reducedMotionQuery).matches;

const indicatorSpring = { type: 'spring', stiffness: 450, damping: 35 };
const indicatorStyles = {
  underline: 'inset-x-0 bottom-0 h-[3px] rounded-full bg-[#C55700] dark:bg-[#FF963D]',
  pill: 'inset-0 rounded-xl bg-[#FFE9D3] ring-1 ring-inset ring-[#D87D2B]/35 dark:bg-[#402911] dark:ring-[#FF963D]/35',
  sidebar: 'inset-0 rounded-xl bg-[#FFE9D3] dark:bg-[#352410]',
};

export function AnimatedTabIndicator({ variant = 'underline' }) {
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion, serverMediaMatch);
  const className = `pointer-events-none absolute z-0 ${indicatorStyles[variant]}`;

  return reducedMotion ? (
    <span aria-hidden="true" className={className} />
  ) : (
    <motion.span
      aria-hidden="true"
      layoutId="active-tab"
      transition={indicatorSpring}
      className={className}
    />
  );
}

export function AnimatedTabs({
  id,
  tabs,
  value,
  onChange,
  label,
  className = '',
  variant = 'underline',
  behavior = 'tabs',
  orientation = 'horizontal',
  fullWidth = false,
  scrollRef,
  onScroll,
}) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const desktop = useSyncExternalStore(subscribeToDesktop, isDesktop, serverMediaMatch);
  const vertical = orientation === 'vertical' || (orientation === 'responsive' && desktop);
  const tabbed = behavior === 'tabs';
  const pill = variant === 'pill';
  const layout = {
    horizontal: fullWidth ? 'items-stretch' : 'items-center',
    vertical: 'flex-col items-stretch',
    responsive: 'items-center lg:flex-col lg:items-stretch',
  }[orientation];

  function handleKeyDown(event, index) {
    const last = tabs.length - 1;
    const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const nextIndex = {
      [previous]: index === 0 ? last : index - 1,
      [next]: index === last ? 0 : index + 1,
      Home: 0,
      End: last,
    }[event.key];
    if (!Number.isInteger(nextIndex)) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (nextTab.id !== value) onChange(nextTab.id);
    event.currentTarget.parentElement?.children[nextIndex]?.focus();
  }

  return (
    <LayoutGroup id={groupId}>
      <motion.div
        ref={scrollRef}
        onScroll={onScroll}
        layoutScroll
        role={tabbed ? 'tablist' : 'group'}
        aria-label={label}
        aria-orientation={tabbed && vertical ? 'vertical' : undefined}
        className={`isolate flex min-w-0 select-none overflow-x-auto overscroll-x-contain no-scrollbar ${layout} ${
          pill ? 'gap-1.5' : 'gap-4 border-b border-[#EFECE6] sm:gap-6 dark:border-white/10'
        } ${className}`}
      >
        {tabs.map((tab, index) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              id={tabbed ? `${groupId}-${tab.id}` : undefined}
              type="button"
              role={tabbed ? 'tab' : undefined}
              aria-selected={tabbed ? active : undefined}
              aria-controls={tabbed && active ? `${groupId}-panel` : undefined}
              aria-pressed={tabbed ? undefined : active}
              tabIndex={tabbed && !active ? -1 : undefined}
              onClick={() => onChange(tab.id)}
              onKeyDown={tabbed ? (event) => handleKeyDown(event, index) : undefined}
              className={`relative inline-flex cursor-pointer items-center font-bold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#C55700] motion-reduce:transition-none dark:focus-visible:outline-[#FF963D] ${
                fullWidth
                  ? 'min-w-0 flex-1 justify-center text-center leading-snug [overflow-wrap:anywhere]'
                  : 'shrink-0 whitespace-nowrap'
              } ${
                pill
                  ? `min-h-8 gap-2 rounded-xl text-xs ${fullWidth ? 'px-1 py-2 sm:px-3' : 'px-3 py-1.5'} ${active
                    ? 'text-[#873D00] dark:text-[#FFC28B]'
                    : 'bg-black/5 text-[#4A4540] hover:bg-black/10 dark:bg-white/5 dark:text-[#D0D0D0] dark:hover:bg-white/10'}`
                  : `min-h-11 gap-1.5 px-1 pb-1 text-sm ${active
                    ? 'text-[#0F0F0F] dark:text-[#F1F1F1]'
                    : 'text-[#606060] hover:text-[#0F0F0F] dark:text-[#AAAAAA] dark:hover:text-[#F1F1F1]'}`
              }`}
            >
              {active && <AnimatedTabIndicator variant={variant} />}
              <span className="relative z-10 flex min-w-0 items-center gap-1.5">
                {tab.icon}
                <span>{tab.label}</span>
              </span>
              {tab.badge != null && (
                <span className={`relative z-10 ml-auto rounded-md px-1.5 text-[10px] font-semibold tabular-nums ${
                  active
                    ? 'bg-[#C55700]/10 text-[#873D00] dark:bg-[#FF963D]/15 dark:text-[#FFC28B]'
                    : 'bg-black/5 text-[#606060] dark:bg-white/10 dark:text-[#BBBBBB]'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </motion.div>
    </LayoutGroup>
  );
}

export function AnimatedTabPanel({ id, value, behavior = 'tabs', className, children }) {
  const panelRef = useRef(null);
  const previousValue = useRef(value);
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion, serverMediaMatch);
  const tabbed = behavior === 'tabs' && id != null;

  useLayoutEffect(() => {
    const changed = previousValue.current !== value;
    previousValue.current = value;
    if (!changed || reducedMotion) return;

    // Animate the existing panel so a tab change doesn't reset state or focus.
    const animation = panelRef.current?.animate?.(
      [{ opacity: 0.65, translate: '0 5px' }, { opacity: 1, translate: '0 0' }],
      { duration: 200, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    );
    return () => animation?.cancel();
  }, [value, reducedMotion]);

  return (
    <div
      ref={panelRef}
      id={tabbed ? `${id}-panel` : undefined}
      role={tabbed ? 'tabpanel' : undefined}
      aria-labelledby={tabbed ? `${id}-${value}` : undefined}
      tabIndex={tabbed ? 0 : undefined}
      className={className}
    >
      {children}
    </div>
  );
}
