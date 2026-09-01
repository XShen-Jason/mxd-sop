import { useEffect, useState } from 'react';

export function ItemThumbnail({ src, alt, size = 'medium' }: { src?: string; alt: string; size?: 'small' | 'medium' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const visible = Boolean(src) && !failed;
  return <span className={`item-thumbnail item-thumbnail-${size} ${visible ? 'has-image' : 'is-empty'}`} aria-hidden={visible ? undefined : true}>
    {visible && <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
  </span>;
}
