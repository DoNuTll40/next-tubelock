'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, CornerDownLeft, Eye, GripVertical, Image as ImageIcon, ImagePlus, Images, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import BrowserMediaImage from '@/components/BrowserMediaImage';
import { AnimatedTabs } from '@/components/ui/AnimatedTabs';
import DescriptionRichTextEditor from '@/components/ui/DescriptionRichTextEditor';
import { appendDescriptionImage, parseDescriptionImages } from '@/lib/descriptionImages.mjs';
import UploadDescriptionPreview from './UploadDescriptionPreview';
import styles from './UploadDescriptionEditor.module.css';

function Photo({ photo, index, count, onRemove, onMove, onCaption, onDragStart, onDrop }) {
  return <li data-upload-photo="" draggable onDragStart={onDragStart} onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    <div data-upload-photo-image="">
      <BrowserMediaImage src={photo.src} alt={photo.alt || `ภาพที่ ${index + 1}`} loading="lazy" decoding="async" draggable={false} />
      <span data-upload-grip=""><GripVertical size={14} aria-hidden="true" /></span>
      <button type="button" data-upload-remove="" aria-label={`ลบภาพที่ ${index + 1}`} onClick={onRemove}><X size={14} /></button>
      {index === 0 && count > 1 && <span data-upload-cover="">ปกอัลบั้ม</span>}
    </div>
    <input aria-label={`คำบรรยายภาพที่ ${index + 1}`} placeholder="คำบรรยายภาพ" value={photo.alt} onChange={event => onCaption(event.target.value)} />
    {count > 1 && <div data-upload-photo-order=""><span>{index + 1} / {count}</span><button type="button" disabled={index === 0} aria-label={`เลื่อนภาพที่ ${index + 1} ไปก่อนหน้า`} onClick={() => onMove(-1)}><ArrowLeft size={13} /></button><button type="button" disabled={index === count - 1} aria-label={`เลื่อนภาพที่ ${index + 1} ไปถัดไป`} onClick={() => onMove(1)}><ArrowRight size={13} /></button></div>}
  </li>;
}

export default function UploadDescriptionEditor({ value, onSave, title, tags = [], previewMeta, draftNote, attachmentLimit, fileOptions, includeTimestamp }) {
  const [edit, setEdit] = useState(null);
  const { text: description, document: richDocument, albums } = edit ?? value;
  const [view, setView] = useState('edit');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageLinkOpen, setImageLinkOpen] = useState(false);
  const [imageLinkError, setImageLinkError] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialog = useRef(null);
  const dialogBody = useRef(null);
  const viewScroll = useRef({ edit: 0, preview: 0 });
  const manageSections = useRef(new Map());
  const dialogHeading = useRef(null);
  const editButton = useRef(null);
  const closing = useRef(false);
  const addingFiles = useRef(false);
  const edited = useRef(false);
  const backdropPressed = useRef(false);
  const picker = useRef(null);
  const richEditor = useRef(null);
  const targetAlbum = useRef(null);
  const objectUrls = useRef(new Set());
  const mounted = useRef(true);
  const descriptionId = useId();
  const dialogTitleId = useId();
  const dialogHelpId = useId();
  const reduceMotion = useReducedMotion();
  const total = albums.reduce((sum, album) => sum + album.images.length, 0);
  const atLimit = Boolean(attachmentLimit && total >= attachmentLimit);
  const singleCount = albums.filter(album => album.images.length === 1).length;
  const albumCount = albums.filter(album => album.images.length > 1).length;
  const attachmentSummary = [albumCount ? `${albumCount} อัลบั้ม` : '', singleCount ? `${singleCount} ภาพเดี่ยว` : '', albumCount ? `${total} รูป` : ''].filter(Boolean).join(' · ') || 'ยังไม่มีภาพแนบ';
  const readyAlbums = albums.filter(album => album.images.length).map(album => ({ ...album, title: album.title.trim() || 'อัลบั้มไม่มีชื่อ' }));

  useEffect(() => {
    mounted.current = true;
    const urls = objectUrls.current;
    return () => { mounted.current = false; urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [dialogOpen]);

  useLayoutEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      dialogBody.current.scrollTop = viewScroll.current[view];
    }
  }, [view]);

  function switchView(next) {
    if (next === view) return;
    viewScroll.current[view] = dialogBody.current.scrollTop;
    setView(next);
  }

  function manageAlbum(id) {
    const section = manageSections.current.get(id);
    if (!section) return;
    const body = dialogBody.current;
    section.focus({ preventScroll: true });
    const top = body.scrollTop + section.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTo({ top: top - 16, behavior: reduceMotion ? 'instant' : 'smooth' });
  }

  function openEditor() {
    if (dialog.current.open) return;
    closing.current = false;
    edited.current = false;
    setEdit({
      ...value,
      albums: value.albums.map(album => ({
        ...album,
        images: album.images.map((image, index) => ({ ...image, id: image.id || `${album.id}-${index}` })),
      })),
    });
    setError('');
    setImageLinkOpen(false);
    setImageLinkError('');
    viewScroll.current = { edit: 0, preview: 0 };
    setView('edit');
    dialog.current.showModal();
    dialogBody.current.scrollTop = 0;
    setDialogOpen(true);
    dialogHeading.current?.focus({ preventScroll: true });
  }

  async function closeEditor() {
    if (!dialog.current?.open || closing.current || addingFiles.current) return;
    closing.current = true;
    const element = dialog.current;
    if (edited.current) {
      setSaving(true);
      setError('');
      try {
        await onSave({ document: richDocument, albums, text: description });
      } catch (error) {
        closing.current = false;
        setSaving(false);
        setError(error.message || 'เก็บการแก้ไขไม่สำเร็จ กรุณาลองอีกครั้ง');
        requestAnimationFrame(() => dialog.current?.querySelector('[data-upload-error]')?.focus({ preventScroll: true }));
        return;
      }
    }
    if (!reduceMotion) {
      const animation = element.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 150, easing: 'ease-in' });
      try { await animation.finished; } catch { /* A detached dialog needs no exit animation. */ }
    }
    element.close();
  }

  function changeDocument(nextDocument, text) {
    edited.current = true;
    setEdit(current => current && ({ ...current, document: nextDocument, text }));
  }

  function changeAlbums(update) {
    edited.current = true;
    setEdit(current => current && ({ ...current, albums: update(current.albums) }));
  }

  function updateAlbum(id, update) {
    changeAlbums(current => current.map(album => album.id === id ? update(album) : album));
  }

  function release(photo) {
    if (objectUrls.current.delete(photo.src)) URL.revokeObjectURL(photo.src);
  }

  function selectFiles(id = null) {
    targetAlbum.current = id;
    picker.current.click();
  }

  function createAlbum() {
    const id = crypto.randomUUID();
    changeAlbums(current => [...current, { id, title: '', images: [] }]);
    richEditor.current?.insertAlbum(id);
  }

  async function addFiles(files, id = null) {
    if (!files.length || addingFiles.current || closing.current) return;
    if (atLimit) {
      setError(`แนบได้สูงสุด ${attachmentLimit} รูป`);
      return;
    }
    addingFiles.current = true;
    setAdding(true); setError('');
    const photos = [];
    const failed = [];
    for (const file of files) {
      if (attachmentLimit && total + photos.length >= attachmentLimit) break;
      const supported = fileOptions ? fileOptions.types.includes(file.type) && file.size <= fileOptions.maxBytes : file.type.startsWith('image/');
      if (!supported) { failed.push(file.name); continue; }
      const src = URL.createObjectURL(file);
      try {
        const decoded = new Image(); decoded.src = src; await decoded.decode();
        if (!mounted.current) { URL.revokeObjectURL(src); continue; }
        objectUrls.current.add(src);
        photos.push({ id: crypto.randomUUID(), src, alt: '', name: file.name, ...(fileOptions && { file }) });
      } catch { URL.revokeObjectURL(src); failed.push(file.name); }
    }
    if (!mounted.current) return;
    if (photos.length) {
      const destination = id || crypto.randomUUID();
      changeAlbums(current => {
        if (current.some(album => album.id === destination)) return current.map(album => album.id === destination ? { ...album, images: [...album.images, ...photos] } : album);
        return [...current, { id: destination, title: '', images: photos }];
      });
      richEditor.current?.insertAlbum(destination, true);
      setAnnouncement(`เพิ่ม ${photos.length} ภาพแล้ว`);
    }
    if (failed.length) setError(`เพิ่มภาพไม่ได้ ${failed.length} ไฟล์ ${fileOptions?.help || 'กรุณาเลือกไฟล์ภาพที่เบราว์เซอร์รองรับ'}`);
    if (photos.length + failed.length < files.length) setError(`แนบได้สูงสุด ${attachmentLimit} รูป เพิ่มภาพได้ ${photos.length} จาก ${files.length} ไฟล์`);
    addingFiles.current = false;
    setAdding(false);
  }

  function addImageLink(event) {
    event.preventDefault();
    if (atLimit || addingFiles.current || closing.current) return;
    const fields = new FormData(event.currentTarget);
    const declaration = appendDescriptionImage('', { src: fields.get('src'), alt: fields.get('alt') });
    if (!declaration) {
      setImageLinkError('กรุณาใช้ลิงก์รูปภาพที่ขึ้นต้นด้วย https://');
      return;
    }
    const [image] = parseDescriptionImages(declaration).images;
    const id = crypto.randomUUID();
    changeAlbums(current => [...current, { id, title: '', images: [{ id: crypto.randomUUID(), ...image }] }]);
    richEditor.current?.insertAlbum(id, true);
    setImageLinkOpen(false);
    setImageLinkError('');
  }

  function handleClose(event) {
    if (event.target !== event.currentTarget) return;
    closing.current = false;
    setSaving(false);
    setDialogOpen(false);
    setEdit(null);
    if (fileOptions) {
      objectUrls.current.forEach(url => URL.revokeObjectURL(url));
      objectUrls.current.clear();
    }
    editButton.current?.focus({ preventScroll: true });
  }

  function movePhoto(albumId, photoId, offset) {
    updateAlbum(albumId, album => {
      const images = [...album.images];
      const from = images.findIndex(photo => photo.id === photoId);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= images.length) return album;
      [images[from], images[to]] = [images[to], images[from]];
      return { ...album, images };
    });
  }

  function drop(event, albumId, photoId) {
    event.preventDefault(); event.stopPropagation(); setDragOver(null);
    if (event.dataTransfer.files.length) { void addFiles([...event.dataTransfer.files], albumId); return; }
    try {
      const source = JSON.parse(event.dataTransfer.getData('application/x-tubelock-photo'));
      if (source.albumId !== albumId || source.photoId === photoId) return;
      updateAlbum(albumId, album => {
        const images = [...album.images];
        const from = images.findIndex(photo => photo.id === source.photoId);
        const to = images.findIndex(photo => photo.id === photoId);
        if (from < 0 || to < 0) return album;
        images.splice(to, 0, images.splice(from, 1)[0]);
        return { ...album, images };
      });
    } catch { /* Other drag payloads are not gallery photos. */ }
  }

  return <div className={styles.uploadLab}>
    <section data-upload-summary="" aria-label="สรุปคำอธิบายวิดีโอ">
      <div data-upload-summary-heading=""><h2>คำอธิบายวิดีโอ</h2><button ref={editButton} type="button" aria-haspopup="dialog" onClick={openEditor}><Pencil size={15} aria-hidden="true" />แก้ไขคำอธิบาย</button></div>
      <p data-upload-summary-text="">{description.trim() || 'เพิ่มคำอธิบายเพื่อบอกเล่าเรื่องราวของวิดีโอนี้'}</p>
      <div data-upload-summary-footer=""><Images size={16} aria-hidden="true" /><span>{attachmentSummary}</span><div data-upload-summary-covers="">{readyAlbums.slice(0, 3).map(album => <BrowserMediaImage key={album.id} src={album.images[0].src} alt="" loading="lazy" />)}</div></div>
    </section>
    <dialog ref={dialog} data-upload-dialog="" aria-labelledby={dialogTitleId} aria-describedby={dialogHelpId} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); void closeEditor(); }} onClose={handleClose} onPointerDown={event => { backdropPressed.current = event.target === event.currentTarget; }} onClick={event => { if (backdropPressed.current && event.target === event.currentTarget) void closeEditor(); }}>
      <div data-upload-dialog-layout="">
        <header data-upload-dialog-header=""><div><h2 ref={dialogHeading} tabIndex={-1} id={dialogTitleId}>แก้ไขคำอธิบาย</h2><p id={dialogHelpId}>จัดรูปแบบข้อความและวางอัลบั้มในตำแหน่งที่ต้องการ</p></div><button type="button" disabled={adding || saving} aria-label="ปิดตัวแก้ไขคำอธิบาย" onClick={() => void closeEditor()}><X size={20} /></button></header>
        <div data-upload-mobile-tabs="" inert={saving}><AnimatedTabs label="มุมมองคำอธิบาย" variant="pill" behavior="filter" fullWidth tabs={[{ id: 'edit', label: 'แก้ไข' }, { id: 'preview', label: 'ตัวอย่างผู้ชม' }]} value={view} onChange={switchView} /></div>
        <div ref={dialogBody} data-upload-dialog-body="" inert={saving}>
    <div data-upload-columns="" data-mobile-view={view}>
      <section data-upload-editor="" aria-label="ออกแบบคำอธิบายหน้า Upload">
        <label data-upload-label="" htmlFor={descriptionId}>คำอธิบาย</label>
        <div data-upload-description="" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) drop(event, null); }}>
          {edit && <DescriptionRichTextEditor ref={richEditor} id={descriptionId} initialDocument={richDocument} albums={albums} onChange={changeDocument} onFiles={files => void addFiles(files)} onManageAlbum={manageAlbum} />}
          <div data-upload-toolbar="">
            <button type="button" disabled={adding || atLimit} onClick={() => selectFiles()}><ImagePlus size={16} />แนบภาพ</button>
            <button type="button" disabled={atLimit} onClick={createAlbum}><Plus size={16} />สร้างอัลบั้ม</button>
            {fileOptions && <button type="button" disabled={adding || atLimit} aria-expanded={imageLinkOpen} onClick={() => { setImageLinkOpen(open => !open); setImageLinkError(''); }}><Link2 size={16} />แนบภาพจากลิงก์</button>}
            {includeTimestamp && <button type="button" onClick={() => richEditor.current?.appendTimestamp()}><Plus size={16} />เพิ่มโครงร่างไทม์แสตมป์</button>}
            <span>{description.length.toLocaleString()} ตัวอักษร</span>
          </div>
          {imageLinkOpen && <form data-rich-link="" onSubmit={addImageLink}>
            <label><span className="sr-only">ลิงก์รูปภาพ</span><input name="src" type="url" aria-label="ลิงก์รูปภาพ" placeholder="https://…" maxLength={4096} required /></label>
            <label><span className="sr-only">คำบรรยายภาพจากลิงก์</span><input name="alt" placeholder="คำบรรยายภาพ (ไม่บังคับ)" maxLength={1000} /></label>
            <button type="submit" disabled={adding || atLimit}>เพิ่มภาพ</button>
            {imageLinkError && <p role="alert">{imageLinkError}</p>}
          </form>}
        </div>
        <input ref={picker} type="file" multiple accept={fileOptions?.types.join(',') || 'image/*'} hidden aria-label="เลือกภาพแนบคำอธิบาย" onChange={event => { void addFiles([...event.target.files], targetAlbum.current); event.target.value = ''; }} />
        <div data-upload-albums-heading=""><h3>ภาพแนบ <span>{attachmentSummary}</span></h3><span>{attachmentLimit ? `${total}/${attachmentLimit} รูป` : 'ไม่จำกัดจำนวนรูป'}</span></div>
        <p className="sr-only" aria-live="polite">{announcement}</p>
        <div data-upload-albums=""><AnimatePresence initial={false}>
          {edit && albums.map((album, albumIndex) => <motion.section key={album.id} ref={element => {
            if (element) manageSections.current.set(album.id, element);
            else manageSections.current.delete(album.id);
          }} tabIndex={-1} aria-label={album.title.trim() || `ภาพแนบที่ ${albumIndex + 1}`} data-upload-album="" data-drag-over={dragOver === album.id || undefined} initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragOver(album.id); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(null); }} onDrop={event => drop(event, album.id)}>
            <div data-upload-album-heading="">{album.images.length === 1 ? <><ImageIcon size={17} aria-hidden="true" /><strong data-upload-single-title="">ภาพแนบ</strong></> : <><Images size={17} aria-hidden="true" /><input aria-label={`ชื่ออัลบั้มที่ ${albumIndex + 1}`} placeholder="ตั้งชื่ออัลบั้ม…" value={album.title} onChange={event => updateAlbum(album.id, current => ({ ...current, title: event.target.value }))} /></>}<span>{album.images.length} รูป</span><button type="button" data-upload-insert-album="" title="แทรกตรงเคอร์เซอร์" aria-label={`แทรก${album.images.length === 1 ? 'ภาพ' : 'อัลบั้ม'}ที่ ${albumIndex + 1} ในข้อความ`} onClick={() => richEditor.current?.insertAlbum(album.id)}><CornerDownLeft size={15} /></button><button type="button" disabled={adding} data-upload-delete-album="" aria-label={`ลบ${album.images.length === 1 ? 'ภาพแนบ' : 'อัลบั้ม'}ที่ ${albumIndex + 1}`} onClick={() => { richEditor.current?.removeAlbum(album.id); album.images.forEach(release); changeAlbums(current => current.filter(item => item.id !== album.id)); }}><Trash2 size={15} /></button></div>
            <ul data-upload-photo-grid="">{album.images.map((photo, index) => <Photo key={photo.id} photo={photo} index={index} count={album.images.length} onRemove={() => { release(photo); updateAlbum(album.id, current => ({ ...current, images: current.images.filter(item => item.id !== photo.id) })); }} onMove={offset => movePhoto(album.id, photo.id, offset)} onCaption={alt => updateAlbum(album.id, current => ({ ...current, images: current.images.map(item => item.id === photo.id ? { ...item, alt } : item) }))} onDragStart={event => { event.dataTransfer.setData('application/x-tubelock-photo', JSON.stringify({ albumId: album.id, photoId: photo.id })); event.dataTransfer.effectAllowed = 'move'; }} onDrop={event => drop(event, album.id, photo.id)} />)}</ul>
            <button type="button" data-upload-add-photos="" disabled={adding || atLimit} onClick={() => selectFiles(album.id)}><ImagePlus size={16} />{album.images.length === 1 ? 'เพิ่มภาพเพื่อสร้างอัลบั้ม' : album.images.length ? 'เพิ่มภาพในอัลบั้ม' : 'เลือกภาพ หรือลากไฟล์มาวาง'}</button>
          </motion.section>)}
        </AnimatePresence></div>
        {!albums.length && <button type="button" data-upload-empty="" onClick={() => selectFiles()}><ImagePlus size={25} /><strong>เพิ่มภาพให้เรื่องราวของคุณ</strong><span>เลือกหลายรูปเพื่อเริ่มอัลบั้มแรก</span></button>}
      </section>
      <aside data-upload-preview="" aria-label="ตัวอย่างคำอธิบายสำหรับผู้ชม">
        <div data-upload-preview-heading=""><Eye size={16} /><h2>ตัวอย่างผู้ชม</h2><span>อัปเดตทันที</span></div>
        <div data-upload-watch=""><h3>{title || 'วิดีโอยังไม่มีชื่อ'}</h3><div data-upload-watch-desc="">{previewMeta && <p data-upload-meta="">{previewMeta}</p>}{tags.length > 0 && <p data-upload-tags="">{tags.map(tag => `#${tag}`).join(' ')}</p>}<UploadDescriptionPreview document={richDocument} albums={readyAlbums} /></div></div>
        {total > 0 && <p data-upload-preview-help="">แตะภาพเพื่อเปิดภาพเต็ม</p>}
      </aside>
    </div>
        </div>
        <footer data-upload-dialog-footer="">
          <div>
            <span>{attachmentSummary}{draftNote && <span data-upload-draft-note=""> · {draftNote}</span>}</span>
            {(adding || saving) && <p role="status">{adding ? 'กำลังเตรียมภาพ…' : 'กำลังเก็บการแก้ไข…'}</p>}
            {error && <p data-upload-error="" role="alert" tabIndex={-1}>{error}</p>}
          </div>
          <button type="button" disabled={adding || saving} onClick={() => void closeEditor()}><Check size={16} aria-hidden="true" />เสร็จสิ้น</button>
        </footer>
      </div>
    </dialog>
  </div>;
}
