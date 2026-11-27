'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Info, X } from 'lucide-react';
import { extractImageMetadata, photoInfoRows } from '@/lib/imageMetadata.mjs';

function Rows({ values }) {
  return <dl>{Object.entries(values).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}

function ImageFileInfo({ image }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const timer = setTimeout(() => controller.abort(), 30000);
    (async () => {
      try {
        const response = await fetch(image.src, { signal: controller.signal, referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('fetch');
        const blob = await response.blob();
        const bytes = await blob.arrayBuffer();
        const size = blob.size >= 1024 * 1024 ? `${(blob.size / (1024 * 1024)).toLocaleString('th-TH', { maximumFractionDigits: 1 })} MB` : blob.size >= 1024 ? `${(blob.size / 1024).toLocaleString('th-TH', { maximumFractionDigits: 1 })} KB` : `${blob.size} B`;
        const file = { 'ความละเอียด': null, 'ขนาดไฟล์': size, 'ชนิดไฟล์': blob.type.replace(/^image\//, '').toUpperCase() || 'ไม่ระบุ' };
        const objectUrl = URL.createObjectURL(blob);
        try {
          const decoded = new Image();
          decoded.src = objectUrl;
          await decoded.decode();
          file['ความละเอียด'] = `${decoded.naturalWidth.toLocaleString()} × ${decoded.naturalHeight.toLocaleString()} px`;
        } catch { /* File metadata may still be readable when the browser cannot decode the image. */ }
        finally { URL.revokeObjectURL(objectUrl); }
        let metadata = {};
        let note = '';
        try { metadata = await extractImageMetadata(bytes); }
        catch { note = 'ตัวอ่าน metadata ยังไม่รองรับรูปแบบนี้ หรือข้อมูลในไฟล์เสียหาย'; }
        if (alive) setResult({ file, metadata, note });
      } catch {
        if (alive) setResult({ error: 'อ่านไฟล์ภาพไม่ได้ ไฟล์อาจไม่พร้อมใช้งาน หรือเว็บต้นทางไม่อนุญาตให้อ่านข้อมูล (CORS)' });
      } finally { clearTimeout(timer); }
    })();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [image.src]);

  if (!result) return <p role="status">กำลังอ่านข้อมูลจากไฟล์ภาพ…</p>;
  if (result.error) return <p role="status">{result.error}</p>;
  const exif = photoInfoRows(result.metadata);
  return <>
    <Rows values={result.file} />
    {Object.keys(exif).length > 0 ? <section data-lightbox-info-exif=""><h4>ข้อมูลการถ่ายภาพ <span>EXIF</span></h4><Rows values={exif} /></section> : <p data-lightbox-info-note="" role="status"><Info size={14} aria-hidden="true" /><span>{result.note || 'ภาพนี้ไม่มีข้อมูลการถ่ายภาพ (EXIF)'}</span></p>}
  </>;
}

export default function LightboxInfo({ image }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef(null);
  const panel = useRef(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => { if (open) panel.current?.querySelector('button')?.focus(); }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <div data-lightbox-info="" onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <AnimatePresence>
      {open && <motion.section ref={panel} id={panelId} data-lightbox-info-panel="" aria-label="ข้อมูลไฟล์ภาพ" initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
        <div data-lightbox-info-title=""><h3>ข้อมูลภาพ</h3><button type="button" aria-label="ปิดข้อมูลภาพ" onClick={close}><X size={17} /></button></div>
        <div data-lightbox-info-body=""><ImageFileInfo key={image.src} image={image} /></div>
      </motion.section>}
    </AnimatePresence>
    <button ref={button} type="button" data-lightbox-info-toggle="" aria-label="ข้อมูลภาพ" title="ข้อมูลภาพ" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}><Info size={19} aria-hidden="true" /></button>
  </div>;
}
