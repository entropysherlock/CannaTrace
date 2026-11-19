"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The page column. The Dashboard uses the full screen width; every other tab keeps the usual column.
 * Goes by the address, not the page contents: visited pages stay loaded in the background.
 */
export function MainColumn({ children }: { children: ReactNode }) {
  const wide = usePathname() === "/dashboard";
  return <main data-testid="page-column" className={`mx-auto w-full min-w-0 flex-1 px-4 py-6 sm:px-6 md:pb-24 ${wide ? "max-w-[1680px]" : "max-w-6xl"}`}>{children}</main>;
}
