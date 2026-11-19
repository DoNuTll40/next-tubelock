/**
 * Shared Video Spoken Language Registry
 * Used by Upload Studio, Studio Video Editor, API routes, and GitHub Actions subtitle worker.
 */

export const VIDEO_LANGUAGES = [
  {
    code: 'th',
    label: 'ไทย (Thai)',
    shortLabel: 'ไทย',
    englishName: 'Thai',
    bcp47: 'th-TH',
    isThai: true,
    isNone: false,
    noWordSpaces: true,
    quickPick: true,
    desc: 'ถอดเสียงเป็นซับไทยโดยตรง ไม่ต้องแปลซ้ำ',
  },
  {
    code: 'ja',
    label: 'ญี่ปุ่น (Japanese)',
    shortLabel: 'ญี่ปุ่น',
    englishName: 'Japanese',
    bcp47: 'ja-JP',
    isThai: false,
    isNone: false,
    noWordSpaces: true,
    quickPick: true,
    desc: 'ถอดซับญี่ปุ่นต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'en',
    label: 'อังกฤษ (English)',
    shortLabel: 'อังกฤษ',
    englishName: 'English',
    bcp47: 'en-US',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: true,
    desc: 'ถอดซับอังกฤษต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'zh',
    label: 'จีนกลาง (Mandarin Chinese)',
    shortLabel: 'จีนกลาง',
    englishName: 'Mandarin Chinese',
    bcp47: 'cmn-Hans-CN',
    isThai: false,
    isNone: false,
    noWordSpaces: true,
    quickPick: true,
    desc: 'ถอดซับจีนกลางต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'ko',
    label: 'เกาหลี (Korean)',
    shortLabel: 'เกาหลี',
    englishName: 'Korean',
    bcp47: 'ko-KR',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: true,
    desc: 'ถอดซับเกาหลีต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'yue',
    label: 'จีนกวางตุ้ง (Cantonese)',
    shortLabel: 'กวางตุ้ง',
    englishName: 'Cantonese',
    bcp47: 'yue-Hant-HK',
    isThai: false,
    isNone: false,
    noWordSpaces: true,
    quickPick: false,
    desc: 'ถอดซับกวางตุ้งต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'vi',
    label: 'เวียดนาม (Vietnamese)',
    shortLabel: 'เวียดนาม',
    englishName: 'Vietnamese',
    bcp47: 'vi-VN',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: false,
    desc: 'ถอดซับเวียดนามต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'id',
    label: 'อินโดนีเซีย (Indonesian)',
    shortLabel: 'อินโดนีเซีย',
    englishName: 'Indonesian',
    bcp47: 'id-ID',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: false,
    desc: 'ถอดซับอินโดนีเซียต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'ms',
    label: 'มาเลย์ (Malay)',
    shortLabel: 'มาเลย์',
    englishName: 'Malay',
    bcp47: 'ms-MY',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: false,
    desc: 'ถอดซับมาเลย์ต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'es',
    label: 'สเปน (Spanish)',
    shortLabel: 'สเปน',
    englishName: 'Spanish',
    bcp47: 'es-ES',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: false,
    desc: 'ถอดซับสเปนต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'fr',
    label: 'ฝรั่งเศส (French)',
    shortLabel: 'ฝรั่งเศส',
    englishName: 'French',
    bcp47: 'fr-FR',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: false,
    desc: 'ถอดซับฝรั่งเศสต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'de',
    label: 'เยอรมัน (German)',
    shortLabel: 'เยอรมัน',
    englishName: 'German',
    bcp47: 'de-DE',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: false,
    desc: 'ถอดซับเยอรมันต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'ru',
    label: 'รัสเซีย (Russian)',
    shortLabel: 'รัสเซีย',
    englishName: 'Russian',
    bcp47: 'ru-RU',
    isThai: false,
    isNone: false,
    noWordSpaces: false,
    quickPick: false,
    desc: 'ถอดซับรัสเซียต้นฉบับ + แปลเป็นไทยอัตโนมัติ',
  },
  {
    code: 'none',
    label: 'ไม่มีเสียงพูด / ดนตรีล้วน (ไม่สร้างซับอัตโนมัติ)',
    shortLabel: 'ไม่มีเสียงพูด',
    englishName: 'None',
    bcp47: '',
    isThai: false,
    isNone: true,
    noWordSpaces: false,
    quickPick: true,
    desc: 'ข้ามการสร้างซับไตเติลอัตโนมัติด้วย AI',
  },
];

const VIDEO_LANGUAGE_MAP = new Map(VIDEO_LANGUAGES.map((lang) => [lang.code, lang]));

const LANGUAGE_ALIASES = {
  'th-th': 'th',
  thai: 'th',
  'ja-jp': 'ja',
  jp: 'ja',
  jpn: 'ja',
  japanese: 'ja',
  'en-us': 'en',
  'en-gb': 'en',
  eng: 'en',
  english: 'en',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-hant': 'zh',
  'zh-tw': 'zh',
  'cmn-hans-cn': 'zh',
  cmn: 'zh',
  mandarin: 'zh',
  chinese: 'zh',
  'yue-hant-hk': 'yue',
  'zh-hk': 'yue',
  cantonese: 'yue',
  'ko-kr': 'ko',
  kor: 'ko',
  korean: 'ko',
  'vi-vn': 'vi',
  vietnamese: 'vi',
  'id-id': 'id',
  indonesian: 'id',
  'ms-my': 'ms',
  malay: 'ms',
  'es-es': 'es',
  'es-419': 'es',
  spanish: 'es',
  'fr-fr': 'fr',
  french: 'fr',
  'de-de': 'de',
  german: 'de',
  'ru-ru': 'ru',
  russian: 'ru',
  no_speech: 'none',
  nospeech: 'none',
};

export function normalizeVideoLanguageCode(raw) {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (!cleaned) return '';
  if (VIDEO_LANGUAGE_MAP.has(cleaned)) return cleaned;
  if (LANGUAGE_ALIASES[cleaned]) return LANGUAGE_ALIASES[cleaned];
  const base = cleaned.split(/[-_]/)[0];
  if (VIDEO_LANGUAGE_MAP.has(base)) return base;
  if (LANGUAGE_ALIASES[base]) return LANGUAGE_ALIASES[base];
  return '';
}

export function getVideoLanguage(raw) {
  const code = normalizeVideoLanguageCode(raw);
  return code ? VIDEO_LANGUAGE_MAP.get(code) || null : null;
}

export function isValidVideoLanguage(raw) {
  return Boolean(getVideoLanguage(raw));
}

export function getVideoLanguageLabel(raw) {
  const lang = getVideoLanguage(raw);
  return lang ? lang.label : '';
}

export const QUICK_PICK_VIDEO_LANGUAGES = VIDEO_LANGUAGES.filter((lang) => lang.quickPick);

export const VIDEO_LANGUAGE_SELECT_OPTIONS = VIDEO_LANGUAGES.map((lang) => ({
  value: lang.code,
  label: lang.label,
  desc: lang.desc,
}));
