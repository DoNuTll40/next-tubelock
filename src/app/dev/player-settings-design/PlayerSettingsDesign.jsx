'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import SettingsSidebar, { SETTING_GROUPS } from '@/components/settings/SettingsSidebar';
import SettingCard from '@/components/ui/SettingCard';
import styles from './prototype.module.css';

const title = 'การเล่นและตัวเล่น';
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
const seekSteps = [5, 10, 15, 30];
const fitModes = [
  { id: 'fit', label: 'พอดีเฟรม', detail: 'เห็นภาพครบตามสัดส่วนเดิม' },
  { id: 'fill', label: 'เต็มจอ', detail: 'ขยายเต็มพื้นที่ตัวเล่น อาจตัดขอบภาพ' },
];
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C55700] dark:focus-visible:outline-[#FF963D]';
const valueColor = 'text-[#873D00] dark:text-[#FFC28B]';
const button = `cursor-pointer rounded-lg ${focus}`;
const row = 'flex min-w-0 items-center justify-between gap-3 px-4 py-3 sm:px-5';

function ChoiceRow({ id, label, children }) {
  return (
    <div className={row}>
      <label htmlFor={id} className="min-w-0 text-sm font-semibold">{label}</label>
      <span className="relative shrink-0">
        {children}
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#74695E] dark:text-[#AAA39B]" />
      </span>
    </div>
  );
}

function ToggleRow({ label, detail, checked, onChange }) {
  const id = useId();
  return (
    <label className={`${row} relative min-h-16 cursor-pointer hover:bg-[#FBF9F5] dark:hover:bg-white/[0.04]`}>
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-sm font-semibold">{label}</span>
        <span id={`${id}-detail`} className="mt-0.5 block text-xs leading-relaxed text-[#6F665D] dark:text-[#B7B0A8]">{detail}</span>
      </span>
      <input type="checkbox" role="switch" aria-labelledby={`${id}-label`} aria-describedby={`${id}-detail`} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className="flex h-6 w-11 shrink-0 items-center rounded-full bg-[#8E8074] p-0.5 transition-colors peer-checked:bg-[#C55700] peer-checked:[&>span]:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[#C55700] motion-reduce:transition-none dark:bg-[#6F6A65] dark:peer-checked:bg-[#FF963D] dark:peer-checked:[&>span]:bg-[#181818] dark:peer-focus-visible:outline-[#FF963D]">
        <span className="size-5 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none dark:bg-[#D5D0CA]" />
      </span>
    </label>
  );
}

export default function PlayerSettingsDesign({ legacyFit }) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const [speed, setSpeed] = useState(legacyFit ? 0.5 : 1);
  const [fit, setFit] = useState(legacyFit ?? 'fit');
  const [seek, setSeek] = useState(10);
  const [volume, setVolume] = useState(80);
  const [autoplay, setAutoplay] = useState(true);
  const [stats, setStats] = useState(false);
  const selectedFit = fit === 'fill' || fit === 'cover' ? 'fill' : 'fit';
  const dialogRef = useRef(null);
  const fitTrigger = useRef(null);
  const overviewTrigger = useRef(null);
  const backButton = useRef(null);
  const id = useId();
  const selectClass = `${button} ${valueColor} h-11 min-w-21 appearance-none border border-[#E8E2D9] bg-[#FBF9F5] py-1.5 pl-3 pr-8 text-right text-sm font-semibold tabular-nums dark:border-white/10 dark:bg-white/5`;

  function changeSection(tab) {
    if (tab === 'player') {
      setShowMenu(false);
      requestAnimationFrame(() => backButton.current?.focus());
    } else {
      router.push(`/settings?${tab}`);
    }
  }

  function openFit() {
    dialogRef.current.showModal();
    dialogRef.current.querySelector('[data-selected="true"]')?.focus();
  }

  return (
    <div className={`${styles.prototype} mx-auto w-full max-w-7xl text-[#212529] dark:text-[#F1F1F1]`}>
      <div className="md:flex md:items-start md:gap-10 md:px-8 md:py-8">
        <div className="sticky top-22 hidden shrink-0 md:block">
          <SettingsSidebar id={id} activeTab="player" onSelectTab={changeSection} />
        </div>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 grid h-14 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-1 border-b border-[#EFECE6] bg-white px-3 dark:border-white/10 dark:bg-[#181818] md:hidden">
            {!showMenu && (
              <button ref={backButton} type="button" aria-label="กลับไปหน้าตั้งค่า" className={`${button} grid size-11 place-items-center`} onClick={() => {
                setShowMenu(true);
                requestAnimationFrame(() => overviewTrigger.current?.focus());
              }}>
                <ArrowLeft aria-hidden="true" className="size-5" />
              </button>
            )}
            <h1 className="col-start-2 text-center text-sm font-bold">{showMenu ? 'การตั้งค่า' : title}</h1>
          </header>

          {showMenu && (
            <nav aria-label="การตั้งค่า" className="grid gap-4 p-4 md:hidden">
              {SETTING_GROUPS.map((group) => (
                <SettingCard key={group.id} title={group.label}>
                  {group.tabs.map(({ id: tab, label, icon: Icon }) => (
                    <button key={tab} ref={tab === 'player' ? overviewTrigger : undefined} type="button" onClick={() => changeSection(tab)} className={`${row} ${button} min-h-12 w-full text-left text-sm`}>
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-[#74695E] dark:text-[#AAA39B]" />
                      <span className="min-w-0 flex-1">{label}</span>
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#74695E] dark:text-[#AAA39B]" />
                    </button>
                  ))}
                </SettingCard>
              ))}
            </nav>
          )}

          <section aria-label={title} className={`${showMenu ? 'hidden md:flex' : 'flex'} min-w-0 flex-col gap-5 px-4 py-4 md:gap-6 md:py-0`}>
            <div className="hidden border-b border-[#EFECE6] pb-3 dark:border-white/10 md:block">
              <h2 className="text-xl font-bold">{title}</h2>
            </div>

            <SettingCard title="เมื่อเปิดวิดีโอ">
              <ChoiceRow id={`${id}-speed`} label="ความเร็วเริ่มต้น">
                <select id={`${id}-speed`} className={selectClass} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {speeds.map((value) => <option key={value} value={value}>{value}×</option>)}
                </select>
              </ChoiceRow>
              <button ref={fitTrigger} type="button" aria-haspopup="dialog" className={`${row} min-h-14 w-full cursor-pointer text-left hover:bg-[#FBF9F5] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#C55700] dark:hover:bg-white/[0.04] dark:focus-visible:outline-[#FF963D]`} onClick={openFit}>
                <span className="min-w-0 text-sm font-semibold">การแสดงภาพ</span>
                <span className={`${valueColor} flex shrink-0 items-center gap-1.5 text-sm font-semibold`}>
                  {fitModes.find((mode) => mode.id === selectedFit).label}
                  <ChevronRight aria-hidden="true" className="size-4 text-[#74695E] dark:text-[#AAA39B]" />
                </span>
              </button>
            </SettingCard>

            <SettingCard title="เสียงและการข้ามเวลา">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(9rem,18rem)_3rem]">
                <label htmlFor={`${id}-volume`} className="text-sm font-semibold">ระดับเสียงเริ่มต้น</label>
                <span aria-hidden="true" className={`${valueColor} text-right text-sm font-semibold tabular-nums md:col-start-3`}>{volume}%</span>
                <input id={`${id}-volume`} type="range" min="0" max="100" step="1" value={volume} aria-valuetext={`${volume}%`} onChange={(e) => setVolume(Number(e.target.value))} className={`${styles.volume} ${focus} col-span-2 h-11 w-full cursor-pointer rounded-sm md:col-span-1 md:col-start-2 md:row-start-1`} />
              </div>
              <ChoiceRow id={`${id}-seek`} label="ข้ามเวลาเมื่อแตะสองครั้ง">
                <select id={`${id}-seek`} className={selectClass} value={seek} onChange={(e) => setSeek(Number(e.target.value))}>
                  {seekSteps.map((value) => <option key={value} value={value}>{value} วินาที</option>)}
                </select>
              </ChoiceRow>
            </SettingCard>

            <SettingCard title="คลิปถัดไปและสถิติ">
              <ToggleRow label="เล่นคลิปถัดไปอัตโนมัติ" detail="เมื่อวิดีโอที่กำลังดูจบ" checked={autoplay} onChange={setAutoplay} />
              <ToggleRow label="แสดงสถิติตัวเล่น" detail="แสดงข้อมูลเทคนิค เช่น บิตเรตและเฟรมต่อวินาที" checked={stats} onChange={setStats} />
            </SettingCard>

            <p className="text-xs text-[#6F665D] dark:text-[#B7B0A8]">หน้าทดลอง ค่าที่เปลี่ยนมีผลเฉพาะในหน้านี้</p>
          </section>
        </div>
      </div>

      <dialog ref={dialogRef} aria-labelledby={`${id}-fit-title`} className={`${styles.dialog} bg-white text-[#212529] dark:bg-[#181818] dark:text-[#F1F1F1]`}
        onClose={() => fitTrigger.current?.focus()} onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}>
        <div>
          <header className="flex items-center justify-between gap-3 border-b border-[#EFECE6] py-1 pl-4 pr-2 dark:border-white/10">
            <h2 id={`${id}-fit-title`} className="text-base font-bold">การแสดงภาพ</h2>
            <button type="button" aria-label="ปิด" className={`${button} grid size-11 place-items-center`} onClick={() => dialogRef.current.close()}>
              <X aria-hidden="true" className="size-5" />
            </button>
          </header>
          <div className="divide-y divide-[#EFECE6] dark:divide-white/10">
            {fitModes.map((mode) => {
              const selected = mode.id === selectedFit;
              return (
                <button key={mode.id} type="button" aria-pressed={selected} data-selected={selected}
                  onClick={() => { setFit(mode.id); dialogRef.current.close(); }}
                  className={`grid w-full cursor-pointer grid-cols-[4rem_minmax(0,1fr)_1.25rem] items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#C55700] dark:focus-visible:outline-[#FF963D] ${selected ? 'bg-[#FFF5EB] dark:bg-[#28211B]' : 'hover:bg-[#FBF9F5] dark:hover:bg-white/5'}`}>
                  <span aria-hidden="true" className={styles.frame} data-fit={mode.id}><span /></span>
                  <span>
                    <span className="block text-sm font-semibold">{mode.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-[#6F665D] dark:text-[#B7B0A8]">{mode.detail}</span>
                  </span>
                  {selected && <Check aria-hidden="true" className={`${valueColor} size-5`} />}
                </button>
              );
            })}
          </div>
        </div>
      </dialog>
    </div>
  );
}
