import dayjs from "@calcom/dayjs";
import { useLocale } from "@calcom/lib/hooks/useLocale";

type DateColumnProps = {
  startTime: string;
  userTimeZone?: string;
  isUpcoming: boolean;
};

export const DateColumn = ({ startTime, userTimeZone, isUpcoming }: DateColumnProps) => {
  const {
    i18n: { language },
  } = useLocale();

  const bookingYear = dayjs(startTime).year();
  const currentYear = dayjs().year();
  const isDifferentYear = bookingYear !== currentYear;

  const formattedDate = dayjs(startTime)
    .tz(userTimeZone)
    .locale(language)
    .format(isUpcoming ? (isDifferentYear ? "ddd, D MMM YYYY" : "ddd, D MMM") : "D MMMM YYYY");

  return <div className="text-emphasis text-sm leading-6">{formattedDate}</div>;
};
