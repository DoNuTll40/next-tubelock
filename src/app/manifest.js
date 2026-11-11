export default function manifest() {
  return {
    id: '/',
    name: 'TubeLock',
    short_name: 'TubeLock',
    lang: 'th',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0F0F0F',
    theme_color: '#0F0F0F',
    icons: [192, 512].map((size) => ({
      src: `/images/pwa-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any',
    })),
  };
}
