"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { isLocalPicture, PictureCache } from "./picture-cache";

const Context = createContext<PictureCache | null>(null);
function PictureScope({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new PictureCache());
  useEffect(() => () => cache.clear(), [cache]);
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}
export function PictureCacheProvider({
  children,
  accountId,
}: {
  children: ReactNode;
  accountId?: string;
}) {
  return (
    <PictureScope key={accountId ?? "signed-out"}>{children}</PictureScope>
  );
}
export const usePictureCache = () => useContext(Context);
export function usePictureSource(image: string | null | undefined) {
  const cache = usePictureCache();
  const local = Boolean(image && isLocalPicture(image));
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!cache || !image || !isLocalPicture(image)) return;
    let active = true;
    const resource = cache.acquire(image);
    void resource.promise
      .then(() => {
        if (active) refresh((value) => value + 1);
      })
      .catch(() => {});
    return () => {
      active = false;
      resource.release();
    };
  }, [cache, image]);
  if (!local || !cache) return image;
  return image ? cache.peek(image) : undefined;
}
