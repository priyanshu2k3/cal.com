import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";
import { Badge } from "@calcom/ui/components/badge";

type EventColumnProps = {
  title: string;
  description?: string | null;
  isCancelled: boolean;
  showPendingPayment: boolean;
};

export const EventColumn = ({ title, isCancelled, showPendingPayment }: EventColumnProps) => {
  const { t } = useLocale();

  return (
    <div>
      <div
        title={title}
        className={classNames(
          "max-w-10/12 sm:max-w-56 text-emphasis flex items-center gap-2 text-sm font-medium leading-6 md:max-w-full",
          isCancelled ? "line-through" : ""
        )}>
        <div className="bg-subtle h-4 w-0.5 rounded-lg" />
        {title}
        {showPendingPayment && (
          <Badge className="hidden sm:inline-flex" variant="orange">
            {t("pending_payment")}
          </Badge>
        )}
      </div>
    </div>
  );
};
