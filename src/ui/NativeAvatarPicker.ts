import { Capacitor, registerPlugin } from '@capacitor/core';

interface AvatarPickerResult {
  canceled?: boolean;
  uri?: string;
  mimeType?: string;
  name?: string;
}

interface AvatarPickerPlugin {
  pickImage(): Promise<AvatarPickerResult>;
}

const NativeAvatarPicker = registerPlugin<AvatarPickerPlugin>('AvatarPicker');

export function usesNativeAndroidAvatarPicker(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function pickNativeAndroidAvatar(): Promise<File | null> {
  if (!usesNativeAndroidAvatarPicker()) return null;
  const result = await NativeAvatarPicker.pickImage();
  if (result.canceled) return null;
  if (!result.uri) throw new Error('未收到所选头像');

  const response = await fetch(Capacitor.convertFileSrc(result.uri));
  if (!response.ok) throw new Error('无法读取所选头像');
  const blob = await response.blob();
  const mimeType = result.mimeType?.startsWith('image/') ? result.mimeType : blob.type;
  if (!mimeType?.startsWith('image/')) throw new Error('请选择图片文件');
  return new File([blob], result.name?.trim() || 'avatar', { type: mimeType });
}
