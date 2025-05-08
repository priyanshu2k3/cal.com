import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";
import { Badge } from "@calcom/ui/components/badge";

type EventColumnProps = {
  title: string;
  description?: string | null;
  isCancelled: boolean;
  showPendingPayment: boolean;
};

export const EventColumn = ({ title, description, isCancelled, showPendingPayment }: EventColumnProps) => {
  const { t } = useLocale();

  return (
    <div>
      <div
        title={title}
        className={classNames(
          "max-w-10/12 sm:max-w-56 text-emphasis text-sm font-medium leading-6 md:max-w-full",
          isCancelled ? "line-through" : ""
        )}>
        {title}
        {showPendingPayment && (
          <Badge className="hidden sm:inline-flex" variant="orange">
            {t("pending_payment")}
          </Badge>
        )}
      </div>
      {description && (
        <div
          className="max-w-10/12 sm:max-w-32 md:max-w-52 xl:max-w-80 text-default truncate text-sm"
          title={description}>
          &quot;{description}&quot;
        </div>
      )}
    </div>
  );
};
