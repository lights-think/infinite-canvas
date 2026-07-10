import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { deleteAicyCanvasFile, isAicyCanvasMode, listAicyCanvasFiles, readAicyCanvasFile, saveAicyCanvasFile } from "@/services/aicy-integration";
import { resolveCanvasImageBlob, type CanvasImageSource } from "@/services/canvas-image-source";

export type { CanvasImageSource } from "@/services/canvas-image-source";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

async function createUploadedImage(storageKey: string, blob: Blob): Promise<UploadedImage> {
    const url = objectUrls.get(storageKey) || URL.createObjectURL(blob);
    if (!objectUrls.has(storageKey)) objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function uploadImage(input: string | Blob | CanvasImageSource): Promise<UploadedImage> {
    if (input instanceof Blob) return storeNewImage(input);
    const resolved = await resolveCanvasImageBlob(typeof input === "string" ? { dataUrl: input } : input, {
        readStoredFile: getImageBlob,
        fetchBlob: fetchImageBlob,
    });
    // storageKey 表示图片已经持久化，不能再生成新 key 或重复上传。
    if (resolved.storageKey) return createUploadedImage(resolved.storageKey, resolved.blob);
    return storeNewImage(resolved.blob);
}

async function storeNewImage(blob: Blob) {
    const storageKey = `image:${nanoid()}`;
    if (isAicyCanvasMode()) await saveAicyCanvasFile(storageKey, blob);
    else await store.setItem(storageKey, blob);
    return createUploadedImage(storageKey, blob);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = isAicyCanvasMode() ? await readAicyCanvasFile(storageKey) : await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    if (isAicyCanvasMode()) return readAicyCanvasFile(storageKey);
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (isAicyCanvasMode()) await saveAicyCanvasFile(storageKey, blob);
    else await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: CanvasImageSource) {
    const resolved = await resolveCanvasImageBlob(image, { readStoredFile: getImageBlob, fetchBlob: fetchImageBlob });
    return blobToDataUrl(resolved.blob);
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            if (isAicyCanvasMode()) await deleteAicyCanvasFile(key);
            else await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    if (isAicyCanvasMode()) {
        for (const key of await listAicyCanvasFiles()) {
            if (key.startsWith("image:") && !usedKeys.has(key)) unused.push(key);
        }
    } else {
        await store.iterate((_value, key) => {
            if (!usedKeys.has(key)) unused.push(key);
        });
    }
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function fetchImageBlob(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`读取图片失败：${response.status}`);
    return response.blob();
}
