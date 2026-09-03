import type { KnowledgeBallAuthClient } from '../auth/AuthClient';

const AVATAR_SIZE = 512;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const TARGET_OUTPUT_BYTES = 500 * 1024;
const MIN_WEBP_QUALITY = 0.55;
const AVATAR_BUCKET = 'avatars';
const AVATAR_OBJECT = 'avatar.webp';

interface DecodedAvatar {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}

export async function prepareAvatarWebp(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > MAX_INPUT_BYTES) throw new Error('头像原图不能超过 20 MB');

  const decoded = await decodeAvatar(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error('无法读取头像尺寸');
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前设备无法处理头像图片');

    const crop = Math.min(decoded.width, decoded.height);
    const sourceX = (decoded.width - crop) / 2;
    const sourceY = (decoded.height - crop) / 2;
    context.drawImage(decoded.source, sourceX, sourceY, crop, crop, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    let quality = 0.86;
    let blob = await canvasToWebp(canvas, quality);
    while (blob.size > TARGET_OUTPUT_BYTES && quality > MIN_WEBP_QUALITY) {
      quality = Math.max(MIN_WEBP_QUALITY, quality - 0.08);
      blob = await canvasToWebp(canvas, quality);
    }
    if (blob.type !== 'image/webp') throw new Error('当前设备不支持 WebP 头像编码');
    return blob;
  } finally {
    decoded.close?.();
  }
}

export async function uploadAvatarWebp(account: KnowledgeBallAuthClient, image: Blob): Promise<string> {
  if (image.type !== 'image/webp') throw new Error('头像必须转换为 WebP 后上传');
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '') ?? '';
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!supabaseUrl || !publishableKey) throw new Error('头像服务未配置');

  const session = await account.publicSession();
  const userId = await account.currentUserId();
  const objectPath = `${userId}/${AVATAR_OBJECT}`;
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${AVATAR_BUCKET}/${encodedPath}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'image/webp',
      'cache-control': '3600',
      'x-upsert': 'true',
    },
    body: image,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message
      : typeof body.error === 'string' ? body.error
      : `头像上传失败 (${response.status})`;
    throw new Error(message);
  }

  return `${supabaseUrl}/storage/v1/object/public/${AVATAR_BUCKET}/${encodedPath}?v=${Date.now()}`;
}

async function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('头像压缩失败'));
        return;
      }
      resolve(blob);
    }, 'image/webp', quality);
  });
}

async function decodeAvatar(file: File): Promise<DecodedAvatar> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* fall through to the image-element decoder */ }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取该图片，请换一张图片重试'));
    };
    image.src = url;
  });
}
