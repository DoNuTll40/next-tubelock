'use client';

import { createContext, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Node } from '@tiptap/core';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { Bold, Code2, GripVertical, Heading2, Images, Italic, Link2, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2, X } from 'lucide-react';
import BrowserMediaImage from '@/components/BrowserMediaImage';

const AlbumContext = createContext(null);
const TIMESTAMP_LINES = ['ไทม์แสตมป์:', '00:00 บทนำ', '00:30 จุดเด่น', '01:00 สรุป'];

function AlbumBlock({ node, selected }) {
  const { albums, onManageAlbum } = useContext(AlbumContext);
  const album = albums.find(item => item.id === node.attrs.albumId);
  const single = album?.images.length === 1;
  const title = single ? album.images[0].alt || album.images[0].name || 'รูปภาพแนบ' : album ? album.title.trim() || 'อัลบั้มไม่มีชื่อ' : 'ไม่พบภาพแนบนี้';
  const canManage = album && onManageAlbum;
  return <NodeViewWrapper data-rich-album="" data-attachment-kind={single ? 'image' : 'album'} data-album-id={node.attrs.albumId} data-drag-handle="" draggable data-selected={selected || undefined} contentEditable={false}>
    <span data-rich-album-handle="" data-drag-handle="" title="ลากเพื่อย้ายตำแหน่งอัลบั้ม"><GripVertical size={17} aria-hidden="true" /></span>
    <span data-rich-album-cover="">{album?.images[0] ? <BrowserMediaImage src={album.images[0].src} alt="" draggable={false} /> : <Images size={21} />}</span>
    <span><strong>{title}</strong><small>{album ? single ? 'ภาพเดี่ยว' : `${album.images.length} รูป` : 'แทรกภาพหรืออัลบั้มใหม่จากรายการด้านล่าง'}</small></span>
    {canManage ? (
      <button type="button" data-rich-album-manage="" aria-label={`จัดการภาพ ${title}`} onClick={() => onManageAlbum(album.id)}>จัดการภาพ</button>
    ) : <span data-rich-album-badge="">{single ? 'ภาพ' : 'อัลบั้ม'}</span>}
  </NodeViewWrapper>;
}

const DescriptionAlbum = Node.create({
  name: 'descriptionAlbum', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ albumId: { default: '' }, kind: { default: 'album' } }),
  parseHTML: () => [{ tag: 'div[data-description-album]', getAttrs: element => ({ albumId: element.getAttribute('data-album-id') || '', kind: element.getAttribute('data-media-kind') === 'image' ? 'image' : 'album' }) }],
  renderHTML: ({ node }) => ['div', { 'data-description-album': '', 'data-album-id': node.attrs.albumId, 'data-media-kind': node.attrs.kind }],
  addNodeView: () => ReactNodeViewRenderer(AlbumBlock),
  markdownTokenizer: {
    name: 'descriptionAlbum', level: 'block',
    start: source => source.search(/:::(?:album|image) /),
    tokenize(source) {
      const match = /^:::(album|image) ([\w-]+)[ \t]*(?:\n|$)/.exec(source);
      return match ? { type: 'descriptionAlbum', raw: match[0], albumId: match[2], kind: match[1] } : undefined;
    },
  },
  parseMarkdown: token => ({ type: 'descriptionAlbum', attrs: { albumId: token.albumId, kind: token.kind || 'album' } }),
  renderMarkdown: node => `:::${node.attrs.kind === 'image' ? 'image' : 'album'} ${node.attrs.albumId}`,
});

export function safeDescriptionLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export default function DescriptionRichTextEditor({ ref, id, initialDocument, albums, onChange, onFiles, onManageAlbum }) {
  const [mode, setMode] = useState('visual');
  const [markdown, setMarkdown] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const markdownInput = useRef(null);
  const linkInput = useRef(null);
  const linkSelection = useRef(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, defaultProtocol: 'https', isAllowedUri: url => Boolean(safeDescriptionLink(url)) } }), Placeholder.configure({ placeholder: 'เล่าเรื่องของคุณ… จัดรูปแบบด้วยแถบเครื่องมือด้านบน' }), Markdown, DescriptionAlbum],
    content: initialDocument,
    editorProps: {
      attributes: { id, role: 'textbox', 'aria-label': 'คำอธิบายแบบจัดรูปแบบ', 'aria-multiline': 'true', 'data-rich-body': '' },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files || [])];
        if (files.length) { onFiles(files); return true; }
        const text = event.clipboardData?.getData('text/plain');
        if (text && !event.clipboardData.getData('text/html') && /(^#{1,6} |^[-*] |^\d+\. |\*\*[^*]+\*\*|^```|^:::(?:album|image) )/m.test(text)) {
          editor?.commands.insertContent(text, { contentType: 'markdown' });
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON(), current.getText()),
  });
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'), strike: current.isActive('strike'), heading: current.isActive('heading'), bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), quote: current.isActive('blockquote'), link: current.isActive('link'), undo: current.can().undo(), redo: current.can().redo(),
  } : {} });

  useEffect(() => { if (linkOpen) linkInput.current?.focus(); }, [linkOpen]);
  useEffect(() => {
    if (!editor) return;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'descriptionAlbum') return;
      const album = albums.find(item => item.id === node.attrs.albumId);
      if (!album) return;
      const kind = album.images.length === 1 ? 'image' : 'album';
      if (node.attrs.kind !== kind) tr.setNodeMarkup(pos, undefined, { ...node.attrs, kind });
    });
    if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true));
  }, [albums, editor]);

  function updateMarkdown(value) {
    setMarkdown(value);
    editor?.commands.setContent(value, { contentType: 'markdown' });
  }

  useImperativeHandle(ref, () => ({
    appendTimestamp() {
      if (!editor) return;
      if (mode === 'markdown') {
        const separator = markdown ? '\n\n' : '';
        updateMarkdown(`${markdown}${separator}${TIMESTAMP_LINES.join('  \n')}\n`);
        return;
      }
      const content = TIMESTAMP_LINES.flatMap((text, index) => [
        ...(index ? [{ type: 'hardBreak' }] : []),
        { type: 'text', text },
      ]);
      editor.chain().focus('end').insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content }).run();
    },
    insertAlbum(albumId, onlyIfMissing = false) {
      if (!editor) return;
      let exists = false;
      editor.state.doc.descendants(node => { if (node.type.name === 'descriptionAlbum' && node.attrs.albumId === albumId) exists = true; });
      if (onlyIfMissing && exists) return;
      if (mode === 'markdown') {
        const field = markdownInput.current;
        const start = field?.selectionStart ?? markdown.length;
        const end = field?.selectionEnd ?? start;
        updateMarkdown(`${markdown.slice(0, start)}\n\n:::album ${albumId}\n\n${markdown.slice(end)}`);
      } else editor.chain().focus().insertContent([{ type: 'descriptionAlbum', attrs: { albumId } }, { type: 'paragraph' }]).run();
    },
    removeAlbum(albumId) {
      if (!editor) return;
      const tr = editor.state.tr;
      const ranges = [];
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'descriptionAlbum' && node.attrs.albumId === albumId) ranges.push([pos, pos + node.nodeSize]); });
      ranges.reverse().forEach(([from, to]) => tr.delete(from, to));
      editor.view.dispatch(tr);
      if (mode === 'markdown') setMarkdown(editor.getMarkdown());
    },
  }));

  function showLink() {
    linkSelection.current = editor ? { from: editor.state.selection.from, to: editor.state.selection.to } : null;
    setLink(editor?.getAttributes('link').href || ''); setLinkError(''); setLinkOpen(value => !value);
  }

  function saveLink(event) {
    event.preventDefault();
    const href = safeDescriptionLink(link.trim());
    if (!href) { setLinkError('ใช้ลิงก์ https://, http://, mailto: หรือ tel:'); return; }
    const selection = linkSelection.current;
    const chain = editor.chain().focus();
    if (selection) chain.setTextSelection(selection);
    if (selection && selection.from === selection.to && !editor.isActive('link')) chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    else chain.extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  }

  const tools = [
    ['ตัวหนา', Bold, 'bold'], ['ตัวเอียง', Italic, 'italic'], ['ขีดเส้นใต้', Underline, 'underline'],
    ['ขีดฆ่า', Strikethrough, 'strike'], ['หัวข้อ', Heading2, 'heading'], ['รายการหัวข้อ', List, 'bullet'],
    ['รายการลำดับเลข', ListOrdered, 'ordered'], ['ข้อความอ้างอิง', Quote, 'quote'],
    ['เพิ่มลิงก์ข้อความ', Link2, 'link'], ['ย้อนกลับ', Undo2, 'undo'], ['ทำซ้ำ', Redo2, 'redo'],
  ];

  function runTool(key) {
    if (key === 'link') { showLink(); return; }
    const commands = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', strike: 'toggleStrike', bullet: 'toggleBulletList', ordered: 'toggleOrderedList', quote: 'toggleBlockquote', undo: 'undo', redo: 'redo' };
    const chain = editor.chain().focus();
    if (key === 'heading') chain.toggleHeading({ level: 2 }).run();
    else chain[commands[key]]().run();
  }

  return <AlbumContext.Provider value={{ albums, onManageAlbum }}><div data-rich-editor="">
    <div data-rich-toolbar="" role="group" aria-label="จัดรูปแบบคำอธิบาย">
      <div data-rich-tools="">{tools.map(([label, Icon, key]) => <button key={key} type="button" title={label} aria-label={label} aria-pressed={['undo', 'redo'].includes(key) ? undefined : Boolean(state?.[key])} disabled={!editor || mode === 'markdown' || (['undo', 'redo'].includes(key) && !state?.[key])} onMouseDown={event => event.preventDefault()} onClick={() => runTool(key)}><Icon size={16} aria-hidden="true" /></button>)}</div>
      <button data-rich-mode="" type="button" aria-pressed={mode === 'markdown'} onClick={() => { if (mode === 'visual') { setMarkdown(editor?.getMarkdown() || ''); setMode('markdown'); } else setMode('visual'); setLinkOpen(false); }}><Code2 size={15} />{mode === 'markdown' ? 'แก้ไขแบบภาพ' : 'Markdown'}</button>
    </div>
    {linkOpen && <form data-rich-link="" onSubmit={saveLink}>
      <label><span className="sr-only">ลิงก์ข้อความ</span><input ref={linkInput} value={link} onChange={event => setLink(event.target.value)} placeholder="https://…" aria-label="ลิงก์ข้อความ" aria-invalid={Boolean(linkError)} /></label><button type="submit">บันทึก</button><button type="button" onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}>เอาลิงก์ออก</button><button type="button" aria-label="ปิดการเพิ่มลิงก์" onClick={() => setLinkOpen(false)}><X size={16} /></button>{linkError && <p role="alert">{linkError}</p>}
    </form>}
    <div hidden={mode !== 'visual'}><EditorContent editor={editor} /></div>
    {mode === 'markdown' && <textarea ref={markdownInput} data-rich-markdown="" aria-label="คำอธิบาย Markdown" value={markdown} onChange={event => updateMarkdown(event.target.value)} spellCheck={false} />}
    <p data-rich-help="">{mode === 'markdown' ? 'ตำแหน่งภาพใช้ :::image และอัลบั้มใช้ :::album สลับกลับเพื่อดูหน้าตาจริง' : 'วางข้อความจาก Word / เว็บ หรือวาง Markdown ได้ · ลากบล็อกภาพหรืออัลบั้มเพื่อเปลี่ยนตำแหน่ง'}</p>
  </div></AlbumContext.Provider>;
}
