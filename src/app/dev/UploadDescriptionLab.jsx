'use client';

import { useState } from 'react';
import UploadDescriptionEditor from '@/components/upload/UploadDescriptionEditor';

const sampleText = 'เส้นทางจากทะเลสาบโมเรนไปยังถนนไอซ์ฟิลด์สพาร์กเวย์ ชมสีของทะเลสาบเมื่อแสงเปลี่ยนระหว่างวัน แล้วแวะจุดชมวิวริมถนนระหว่างทาง';

export default function UploadDescriptionLab({ initialAlbums }) {
  const [value, setValue] = useState(() => ({
    text: sampleText,
    document: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: sampleText }] },
        ...initialAlbums.flatMap(album => [
          { type: 'descriptionAlbum', attrs: { albumId: album.id } },
          { type: 'paragraph' },
        ]),
      ],
    },
    albums: initialAlbums.map(album => ({
      ...album,
      images: album.images.map((image, index) => ({ ...image, id: `${album.id}-${index}` })),
    })),
  }));

  return <UploadDescriptionEditor
    value={value}
    onSave={setValue}
    title="เที่ยวแคนาเดียนร็อกกี"
    tags={['HLS', 'Travel', '1080p']}
    previewMeta={<>25 ครั้ง · 17 ต.ค. 2569 <span>1080p</span></>}
    draftNote="เก็บการแก้ไขไว้ในหน้านี้"
  />;
}
