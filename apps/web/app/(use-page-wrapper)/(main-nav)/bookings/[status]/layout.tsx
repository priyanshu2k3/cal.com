import { ShellMainAppDir } from "app/(use-page-wrapper)/(main-nav)/ShellMainAppDir";
import { getTranslate } from "app/_utils";

export default async function BookingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslate();

  return (
    <ShellMainAppDir heading={t("bookings")} subtitle={t("bookings_description")}>
      {children}
    </ShellMainAppDir>
  );
}
