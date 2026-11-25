export default function BrowserMediaImage({ alt = '', ...props }) {
  // Browser requests preserve cookies, expiring media URLs and canvas CORS mode.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} />;
}
