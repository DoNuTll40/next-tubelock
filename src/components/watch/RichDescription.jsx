'use client';

import { Fragment } from 'react';
import DescriptionGallery from './DescriptionGallery';
import DescriptionLinkChip, { parseDescriptionLink } from './DescriptionLinkChip';
import { DescriptionHashtag, DescriptionTimestamp } from './DescriptionInlineTokens';
import { splitDescriptionTimestamps } from '@/lib/descriptionTimestamps.mjs';
import styles from './RichDescription.module.css';

function linkHref(node) {
  return node?.marks?.find(mark => mark.type === 'link')?.attrs?.href;
}

export default function RichDescription({ document, albums, expanded, concealed = false, onSeek }) {
  function renderText(node, key, interactive = true) {
      let text = node.text || '';
      if (interactive && !(node.marks || []).some(mark => mark.type === 'link' || mark.type === 'code')) {
        text = text.split(/(#[a-zA-Z0-9_\u0E00-\u0E7F]+)/g).map((part, index) => index % 2 ? <DescriptionHashtag key={`${key}-tag-${index}`}>{part}</DescriptionHashtag> : part);
      }
      for (const mark of node.marks || []) {
        if (mark.type === 'bold') text = <strong>{text}</strong>;
        else if (mark.type === 'italic') text = <em>{text}</em>;
        else if (mark.type === 'underline') text = <u>{text}</u>;
        else if (mark.type === 'strike') text = <s>{text}</s>;
        else if (mark.type === 'code') text = <code>{text}</code>;
      }
      return <Fragment key={key}>{text}</Fragment>;
  }

  function renderTextRuns(parts, key, interactive) {
    const children = [];
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const id = `${key}-${index}`;
      const href = linkHref(part);
      const url = href && parseDescriptionLink(href);
      if (!url) {
        children.push(renderText(part, id, interactive));
        continue;
      }

      // A single link can span several text runs with different formatting marks.
      const runs = [part];
      while (index + 1 < parts.length && linkHref(parts[index + 1]) === href) {
        runs.push(parts[++index]);
      }
      const label = runs.map(run => run.text).join('');
      children.push(
        <DescriptionLinkChip key={id} href={url.href} url={url} label={label}>
          {runs.map((run, runIndex) => renderText(run, `${id}-${runIndex}`, interactive))}
        </DescriptionLinkChip>
      );
    }
    return children;
  }

  function renderChildren(content, key, interactive) {
    const children = [];
    for (let index = 0; index < (content?.length || 0); index++) {
      const child = content[index];
      const id = `${key}-${index}`;
      if (child.type !== 'text') {
        children.push(render(child, id, interactive));
        continue;
      }
      const group = [child];
      while (content[index + 1]?.type === 'text') group.push(content[++index]);

      if (!interactive) {
        children.push(...renderTextRuns(group, id, interactive));
        continue;
      }

      let pending = [];
      for (const [segmentIndex, segment] of splitDescriptionTimestamps(group).entries()) {
        if (segment.seconds === undefined) {
          pending.push(...segment.parts);
          continue;
        }
        const segmentKey = `${id}-${segmentIndex}`;
        children.push(...renderTextRuns(pending, `${segmentKey}-before`, interactive));
        pending = [];
        const label = segment.parts.map(part => part.text).join('');
        children.push(
          <DescriptionTimestamp key={segmentKey} label={label} seconds={segment.seconds} onSeek={onSeek}>
            {renderTextRuns(segment.parts, segmentKey, interactive)}
          </DescriptionTimestamp>
        );
      }
      children.push(...renderTextRuns(pending, `${id}-after`, interactive));
    }
    return children;
  }
  function render(node, key, interactive = true) {
    const children = renderChildren(node.content, key, interactive && node.type !== 'codeBlock');
    switch (node.type) {
      case 'doc': return <Fragment key={key}>{children}</Fragment>;
      case 'paragraph': return <p key={key}>{children.length ? children : <br />}</p>;
      case 'heading': return node.attrs?.level === 3 ? <h3 key={key}>{children}</h3> : <h2 key={key}>{children}</h2>;
      case 'bulletList': return <ul key={key}>{children}</ul>;
      case 'orderedList': return <ol key={key} start={node.attrs?.start || 1}>{children}</ol>;
      case 'listItem': return <li key={key}>{children}</li>;
      case 'blockquote': return <blockquote key={key}>{children}</blockquote>;
      case 'codeBlock': return <pre key={key}><code>{children}</code></pre>;
      case 'hardBreak': return <br key={key} />;
      case 'horizontalRule': return <hr key={key} />;
      case 'descriptionAlbum': {
        const album = albums.find(item => item.id === node.attrs?.albumId);
        return album?.images.length ? <div data-rich-preview-album="" key={key}><DescriptionGallery albums={[album]} expanded={expanded} concealed={concealed} /></div> : null;
      }
      default: return <Fragment key={key}>{children}</Fragment>;
    }
  }
  return <div className={`${styles.typography} ${styles.body}`} data-rich-preview="">{render(document, 'description')}</div>;
}
