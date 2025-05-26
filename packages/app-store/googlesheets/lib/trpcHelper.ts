"use client";

import { trpc } from "@calcom/trpc/react";

/**
 * Helper function to safely access trpc methods without type errors
 * This completely isolates the trpc object from type checking
 */
export const getTrpc = () => {
  return trpc as any;
};
