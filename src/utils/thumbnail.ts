import React from 'react';

/**
 * Upgrades thumbnail URLs from YouTube and Google CDNs to high-resolution versions.
 */
export function getHighResThumbnail(url: string | null | undefined): string | null {
  if (!url) return null;

  // 1. Google user content (YouTube Music artist/album/user artwork)
  // e.g. https://lh3.googleusercontent.com/...=w120-h120-l90-rj or =s60
  if (url.includes('googleusercontent.com')) {
    if (url.includes('=')) {
      // Replace existing dimensions or size parameters with 800x800 high quality
      return url.replace(/=([whs]\d+[^?&]*)/, '=w800-h800-l90-rj');
    }
    return `${url}=w800-h800-l90-rj`;
  }

  // 2. YouTube image CDNs (i.ytimg.com, img.youtube.com, ytimg.com)
  try {
    const isYtImg = url.includes('ytimg.com') || url.includes('youtube.com');
    if (isYtImg && (url.includes('/vi/') || url.includes('/vi_webp/'))) {
      const u = new URL(url);
      // Upgrade standard low/medium resolution thumbnails (default, mqdefault, hqdefault, sddefault) to hq720
      u.pathname = u.pathname.replace(
        /\/(default|mqdefault|hqdefault|sddefault)\.(jpg|webp)/i,
        '/hq720.$2'
      );
      return u.toString();
    }
  } catch {
    // If URL parsing fails, fallback to regex replacement on the raw string
    if (url.includes('/vi/') || url.includes('/vi_webp/')) {
      return url.replace(
        /\/(default|mqdefault|hqdefault|sddefault)\.(jpg|webp)/i,
        '/hq720.$2'
      );
    }
  }

  return url;
}

/**
 * Image onError handler to gracefully fall back from hq720 to hqdefault
 * if a specific video does not provide a 720p thumbnail frame.
 */
export function handleThumbnailError(e: React.SyntheticEvent<HTMLImageElement, Event>): void {
  const img = e.currentTarget;
  if (!img) return;

  const currentSrc = img.src || '';

  // Prevent infinite loops if fallback also fails
  if (img.dataset.fallbackTried === 'hqdefault') {
    return;
  }

  if (currentSrc.includes('hq720')) {
    img.dataset.fallbackTried = 'hqdefault';
    img.src = currentSrc.replace(/hq720\.(jpg|webp)/i, 'hqdefault.$1');
    return;
  }

  if (!img.dataset.fallbackTried && currentSrc.includes('googleusercontent.com') && currentSrc.includes('w800')) {
    img.dataset.fallbackTried = 'w544';
    img.src = currentSrc.replace(/=w800-h800[^?&]*/, '=w544-h544-l90-rj');
    return;
  }
}
