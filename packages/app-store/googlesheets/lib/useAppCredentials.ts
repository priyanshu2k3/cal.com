"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

import { trpc } from "@calcom/trpc/react";

export const useAppCredentials = (appSlug: string) => {
  const { data: session } = useSession();
  const [credentials, setCredentials] = useState<any[]>([]);

  // Use trpc as any to avoid type collisions with built-in methods
  const trpcAny = trpc as any;
  const { data: apps, isLoading } = trpcAny.viewer.apps.listLocal.useQuery(
    { category: "other" },
    {
      enabled: !!session?.user,
    }
  );

  useEffect(() => {
    if (apps && !isLoading) {
      const appData = apps.find((app: any) => app.slug === appSlug);
      if (appData && "credentials" in appData) {
        setCredentials((appData as any).credentials || []);
      }
    }
  }, [apps, isLoading, appSlug]);

  return credentials;
};
